import { isRecommendationTrackingEligible } from "./recommendation-eligibility";

export function isHighFit(
  fitScore: number | null | undefined,
  threshold: number,
) {
  return typeof fitScore === "number" && fitScore >= threshold;
}

export function isApplyTodayJob(input: {
  fitScore: number | null | undefined;
  concerns: string | null | undefined;
  status: string | null | undefined;
  appliedAt?: Date | string | null;
  suggestedAction: string | null | undefined;
  highFitThreshold: number;
}) {
  const suggestedAction = input.suggestedAction ?? "";
  const status = input.status ?? "";
  const canStillApply = isRecommendationTrackingEligible(status, input.appliedAt ?? null);

  if (/\bapply\s*today\b/iu.test(suggestedAction) && canStillApply) {
    return true;
  }

  if (/\bapply\b/iu.test(suggestedAction) && canStillApply) {
    return true;
  }

  return (
    isHighFit(input.fitScore, input.highFitThreshold) &&
    !input.concerns?.trim() &&
    canStillApply
  );
}
