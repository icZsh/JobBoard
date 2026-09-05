export const resumeTailoringStatuses = new Set<string>([
  "INTERESTED",
  "APPLYING",
  "APPLIED",
  "INTERVIEWING",
]);

export function canTailorResumeForStatus(status: string | null | undefined) {
  return Boolean(status && resumeTailoringStatuses.has(status));
}
