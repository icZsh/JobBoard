// Client-safe twin of statusHueByStatus in view.ts, which imports the Prisma runtime.
export function getStatusHue(status: string) {
  const hues: Record<string, string> = {
    NEW: "var(--st-new)",
    INTERESTED: "var(--st-interested)",
    APPLYING: "var(--st-applying)",
    APPLIED: "var(--st-applied)",
    INTERVIEWING: "var(--st-interviewing)",
    OFFER: "var(--st-offer)",
    REJECTED: "var(--st-rejected)",
    PASSED: "var(--st-passed)",
    ARCHIVED: "var(--st-archived)",
  };

  return hues[status] ?? "var(--ink-faint)";
}
