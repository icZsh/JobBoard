import assert from "node:assert/strict";
import test from "node:test";
import { createJobStatusUpdater } from "../src/lib/jobs/status-updates";
import type { SavedTracking, TrackingPatch } from "../src/lib/jobs/tracking-client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function tracking(status: string, appliedAt: string | null = null): SavedTracking {
  return { status, appliedAt, notes: null, nextAction: null, nextActionDate: null, resumePath: null, resumeVersion: null };
}

function setup(jobId = "job-a", status = "NEW", appliedAt: string | null = null) {
  let current = { jobId, status, appliedAt };
  const pending: boolean[] = [];
  const errors: unknown[] = [];
  const saved: SavedTracking[] = [];
  const requests: { jobId: string; patch: TrackingPatch; response: ReturnType<typeof deferred<SavedTracking>> }[] = [];
  const update = createJobStatusUpdater((requestedJobId, patch) => {
    const response = deferred<SavedTracking>();
    requests.push({ jobId: requestedJobId, patch, response });
    return response.promise;
  });
  const callbacks = {
    onPendingChange: (value: boolean) => { pending.push(value); },
    onChange: (value: Pick<SavedTracking, "status" | "appliedAt">) => { current = { ...current, ...value }; },
    onSaved: (value: SavedTracking) => { saved.push(value); },
    onError: (error: unknown) => { errors.push(error); },
  };
  return { update, callbacks, requests, pending, errors, saved, current: () => current };
}

test("Today rejects a second status save synchronously until the same job's first response settles", async () => {
  const state = setup();
  const interested = state.update(state.current(), "INTERESTED", state.callbacks);
  const tooSoon = state.update(state.current(), "APPLIED", state.callbacks);

  // Two onChange events can arrive before React renders the disabled select.
  assert.equal(state.requests.length, 1);
  assert.deepEqual(state.pending, [true]);
  assert.equal(state.current().status, "INTERESTED");
  await tooSoon;
  state.requests[0].response.resolve(tracking("INTERESTED"));
  await interested;

  const applied = state.update(state.current(), "APPLIED", state.callbacks);
  assert.equal(state.requests.length, 2);
  assert.equal(state.current().status, "APPLIED");
  assert.ok(state.current().appliedAt);
  assert.deepEqual(state.requests[1].patch, { status: "APPLIED" });
  state.requests[1].response.resolve(tracking("APPLIED", "2026-10-18T01:00:00.000Z"));
  await applied;
  assert.equal(state.current().status, "APPLIED");
  assert.equal(state.current().appliedAt, "2026-10-18T01:00:00.000Z");
  assert.deepEqual(state.pending, [true, false, true, false]);
});

test("a failed status save rolls back both fields, unlocks the job, and permits retry", async () => {
  const state = setup();
  const first = state.update(state.current(), "APPLIED", state.callbacks);
  const error = new Error("offline");
  assert.ok(state.current().appliedAt);
  state.requests[0].response.reject(error);
  await first;

  assert.deepEqual(state.current(), { jobId: "job-a", status: "NEW", appliedAt: null });
  assert.deepEqual(state.errors, [error]);
  assert.deepEqual(state.pending, [true, false]);
  assert.equal(state.saved.length, 0);

  const retry = state.update(state.current(), "INTERESTED", state.callbacks);
  assert.equal(state.requests.length, 2);
  state.requests[1].response.resolve(tracking("INTERESTED"));
  await retry;
  assert.equal(state.current().status, "INTERESTED");
});

test("different jobs can save independently and finish in either order", async () => {
  const first = setup();
  const second = setup("job-b");
  const firstSave = first.update(first.current(), "INTERESTED", first.callbacks);
  // Both jobs intentionally use the same controller, as they do on Today.
  const secondSave = first.update(second.current(), "APPLIED", second.callbacks);
  assert.equal(first.requests.length, 2);
  assert.deepEqual(first.requests.map(({ jobId }) => jobId), ["job-a", "job-b"]);

  first.requests[1].response.resolve(tracking("APPLIED", "2026-10-18T02:00:00.000Z"));
  await secondSave;
  assert.deepEqual(second.pending, [true, false]);
  assert.deepEqual(first.pending, [true]);
  first.requests[0].response.resolve(tracking("INTERESTED"));
  await firstSave;
  assert.equal(first.current().status, "INTERESTED");
  assert.equal(second.current().status, "APPLIED");
});

test("Undo shares the same per-job lock and restores the exact previous application date", async () => {
  for (const previousAppliedAt of [null, "2026-10-12T00:08:15.224Z"]) {
    const state = setup("job-a", "APPLIED", "2026-10-18T02:00:00.000Z");
    const undo = state.update(state.current(), "INTERESTED", state.callbacks, previousAppliedAt);
    const duplicateUndo = state.update(state.current(), "INTERESTED", state.callbacks, previousAppliedAt);
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.requests[0].patch, { status: "INTERESTED", appliedAt: previousAppliedAt });
    assert.equal(state.current().appliedAt, previousAppliedAt);
    await duplicateUndo;
    state.requests[0].response.resolve(tracking("INTERESTED", previousAppliedAt));
    await undo;
    assert.equal(state.current().appliedAt, previousAppliedAt);
    assert.deepEqual(state.pending, [true, false]);
  }
});

test("a failed Undo restores the applied status and date", async () => {
  const appliedAt = "2026-10-18T02:00:00.000Z";
  const state = setup("job-a", "APPLIED", appliedAt);
  const undo = state.update(state.current(), "NEW", state.callbacks, null);
  state.requests[0].response.reject(new Error("offline"));
  await undo;
  assert.deepEqual(state.current(), { jobId: "job-a", status: "APPLIED", appliedAt });
  assert.deepEqual(state.pending, [true, false]);
});
