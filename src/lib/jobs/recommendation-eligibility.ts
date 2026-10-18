export type RecommendationCandidate = {
  jobId: string;
  status: string;
  appliedAt: Date | string | null;
  fitScore: number | null;
  priority: string | null;
  previousRunDates: (Date | string)[];
  repeatReason: string | null;
  repeatEvidenceUrl: string | null;
};

const excludedStatuses = new Set([
  "APPLYING",
  "APPLIED",
  "INTERVIEWING",
  "OFFER",
  "REJECTED",
  "PASSED",
  "ARCHIVED",
]);
const millisecondsPerDay = 24 * 60 * 60 * 1000;
const dailyRecommendationTarget = 10;

export function isRecommendationTrackingEligible(
  status: string,
  appliedAt: Date | string | null,
) {
  return appliedAt === null && !excludedStatuses.has(status);
}

function calendarDay(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / millisecondsPerDay;
}

function hasHttpsEvidence(value: string | null) {
  if (!value?.trim()) return false;

  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

export function selectRecommendations<T extends RecommendationCandidate>(
  candidates: T[],
  runDate: Date,
): { eligible: T[]; suppressed: T[] } {
  const selectedDay = calendarDay(runDate);
  const newCandidates: T[] = [];
  const repeatCandidates: T[] = [];
  const lastRecommendedDays = new Map<T, number>();

  for (const candidate of candidates) {
    if (!isRecommendationTrackingEligible(candidate.status, candidate.appliedAt)) {
      continue;
    }

    const earlierDays = candidate.previousRunDates
      .map(calendarDay)
      .filter((day) => day < selectedDay);

    if (earlierDays.length === 0) {
      newCandidates.push(candidate);
      continue;
    }

    if (
      typeof candidate.fitScore === "number" &&
      candidate.fitScore >= 90 &&
      candidate.priority === "HIGH" &&
      candidate.repeatReason?.trim() &&
      hasHttpsEvidence(candidate.repeatEvidenceUrl)
    ) {
      repeatCandidates.push(candidate);
      lastRecommendedDays.set(candidate, Math.max(...earlierDays));
    }
  }

  newCandidates.sort((left, right) => (right.fitScore ?? -1) - (left.fitScore ?? -1));
  repeatCandidates.sort((left, right) =>
    (right.fitScore ?? -1) - (left.fitScore ?? -1) ||
    lastRecommendedDays.get(left)! - lastRecommendedDays.get(right)!,
  );
  const eligible = [...newCandidates, ...repeatCandidates].slice(0, dailyRecommendationTarget);
  const selected = new Set(eligible);

  return {
    eligible,
    suppressed: candidates.filter((candidate) => !selected.has(candidate)),
  };
}
