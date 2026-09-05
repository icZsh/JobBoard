/** Browser mutations must present an exact origin, including scheme and port. */
export function isSameOrigin(
  request: Request,
  publicUrl = process.env.APP_URL,
): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    // Standalone Next sees its internal bind address in request.url. The browser
    // Host header retains the actual published host/port through Docker mapping.
    const internal = new URL(request.url);
    const expected = new URL(
      publicUrl ||
        `${internal.protocol}//${request.headers.get("host") || internal.host}`,
    );
    // The default deployment is loopback-only. Do not let a DNS-rebound domain
    // bootstrap an administrator by supplying a matching Host and Origin.
    if (
      !publicUrl &&
      !["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname)
    )
      return false;
    const supplied = new URL(origin);
    return (
      ["http:", "https:"].includes(expected.protocol) &&
      supplied.origin === origin &&
      supplied.origin === expected.origin
    );
  } catch {
    return false;
  }
}

export function assertSameOrigin(request: Request) {
  if (!isSameOrigin(request))
    throw new Error("Same-origin browser request required.");
}
