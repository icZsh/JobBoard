import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { importPayloadSchema } from "../import/validation";

const POST_TIMEOUT_MS = 30_000;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function hasCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArtifactJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Import artifacts must contain valid JSON.");
  }
}

function canonicalEndpoint(value: string) {
  const fail = () => new Error("Import endpoint must be an explicit loopback HTTP(S) /api/import-jobs URL without credentials, query, or fragment.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw fail();
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
  if (
    !loopback || !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/api/import-jobs" || url.username || url.password ||
    /[?#@\\\s]/u.test(value)
  ) throw fail();
  return url.href;
}

async function readUtf8File(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error("Import artifacts and state must be regular files.");
    const bytes = await file.readFile();
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("Import artifacts must contain valid UTF-8.");
    return { bytes, text };
  } finally {
    await file.close();
  }
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse((await readUtf8File(path)).text) as unknown;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw new Error("Import state is unreadable; reconcile the saved state before submitting.");
  }
}

async function readArtifacts(runDir: string) {
  const [payloadFile, reportFile] = await Promise.all([
    readUtf8File(join(runDir, "payload.json")),
    readUtf8File(join(runDir, "report.json")),
  ]);
  const report = parseArtifactJson(reportFile.text);
  const payloadSha256 = sha256(payloadFile.bytes);
  if (!record(report) || report.complete !== true) throw new Error("Only a complete collection report can be imported.");
  if (report.payloadSha256 !== payloadSha256) throw new Error("Payload hash does not match the collection report; collect again before importing.");
  const parsed = importPayloadSchema.safeParse(parseArtifactJson(payloadFile.text));
  if (!parsed.success) throw new Error("Payload does not meet the JobBoard import schema.");
  if (parsed.data.jobs.length === 0) throw new Error("An empty shortlist cannot be imported.");
  // Submit these exact validated bytes, preserving collector provenance and file hash.
  return { body: payloadFile.text, payloadSha256 };
}

async function atomicJson(path: string, value: unknown) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => { if (!hasCode(error, "ENOENT")) throw error; });
  }
}

function isSuccessfulResponse(value: unknown) {
  return record(value) && value.ok === true && value.status === "SUCCESS";
}

async function postOnce(targetUrl: string, body: string, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Import request exceeded 30 seconds."));
    }, POST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(targetUrl, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body,
          redirect: "error",
          signal: controller.signal,
        });
        const text = await response.text();
        const result: unknown = JSON.parse(text);
        if (!response.ok || response.redirected || !isSuccessfulResponse(result)) {
          throw new Error("Importer did not confirm SUCCESS.");
        }
        return result;
      })(),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function submitRun(input: {
  runDir: string;
  targetUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<{ status: "imported" | "already-imported"; response: unknown }> {
  const targetUrl = canonicalEndpoint(input.targetUrl);
  const runDir = resolve(input.runDir);
  const initial = await readArtifacts(runDir);
  const stateDir = join(runDir, "import-state");
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  if (!(await lstat(stateDir)).isDirectory()) throw new Error("Import state must be a directory, not a symbolic link.");
  await chmod(stateDir, 0o700);
  const key = sha256(`${targetUrl}\n${initial.payloadSha256}`);
  const lockPath = join(stateDir, `${key}.lock`);
  const pendingPath = join(stateDir, `${key}.pending.json`);
  const successPath = join(stateDir, `${key}.success.json`);
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (hasCode(error, "EEXIST")) throw new Error("Import lock exists; a submission may be in progress. Reconcile stale locks manually.");
    throw error;
  }
  try {
    const saved = await readOptionalJson(successPath);
    if (saved !== undefined) {
      if (!record(saved) || saved.targetUrl !== targetUrl || saved.payloadSha256 !== initial.payloadSha256 || !isSuccessfulResponse(saved.response)) {
        throw new Error("Saved import success is invalid; reconcile the saved state before submitting.");
      }
      return { status: "already-imported", response: saved.response };
    }
    if (await readOptionalJson(pendingPath) !== undefined) throw new Error(`A pending import exists. Reconcile it manually before resubmitting: ${pendingPath}`);
    const current = await readArtifacts(runDir);
    if (current.payloadSha256 !== initial.payloadSha256) throw new Error("Import artifacts changed while acquiring the lock; inspect the run before submitting.");
    const marker = { version: 1, targetUrl, payloadSha256: current.payloadSha256, startedAt: new Date().toISOString() };
    // Once pending is durable, it is never automatically removed, even after success.
    await atomicJson(pendingPath, marker);
    try {
      const response = await postOnce(targetUrl, current.body, input.fetchImpl ?? fetch);
      await atomicJson(successPath, { ...marker, completedAt: new Date().toISOString(), response });
      return { status: "imported", response };
    } catch {
      throw new Error(`Import outcome requires manual reconciliation; pending state retained and automatic resubmission blocked: ${pendingPath}`);
    }
  } finally {
    await rmdir(lockPath);
  }
}
