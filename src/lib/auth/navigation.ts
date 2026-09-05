const allowedAdminPaths = [
  "/today",
  "/board",
  "/import",
  "/settings",
  "/settings/",
  "/jobs/",
];

export function getSafeLoginDestination(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/today";
  }

  try {
    const destination = new URL(value, "http://jobboard.local");
    const isAllowed = allowedAdminPaths.some(
      (path) =>
        destination.pathname === path ||
        (path.endsWith("/") && destination.pathname.startsWith(path)),
    );

    if (destination.origin !== "http://jobboard.local" || !isAllowed) {
      return "/today";
    }

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/today";
  }
}
