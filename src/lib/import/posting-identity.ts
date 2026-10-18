export function getStablePostingId(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const greenhouseId = url.searchParams.get("gh_jid");
    if (greenhouseId && /^\d+$/u.test(greenhouseId)) return `greenhouse:${greenhouseId}`;
    if (["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(url.hostname)) {
      const id = url.pathname.match(/\/jobs\/(\d+)(?:\/|$)/u)?.[1] ?? url.searchParams.get("token");
      if (id && /^\d+$/u.test(id)) return `greenhouse:${id}`;
    }
    if (url.hostname === "jobs.ashbyhq.com") {
      const id = url.pathname.match(/^\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/iu)?.[1];
      if (id) return `ashby:${id.toLowerCase()}`;
    }
    if (["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname)) {
      const id = url.pathname.match(/^\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/iu)?.[1];
      if (id) return `lever:${id.toLowerCase()}`;
    }
  } catch { /* Invalid URLs have no stable identity. */ }
  return null;
}
