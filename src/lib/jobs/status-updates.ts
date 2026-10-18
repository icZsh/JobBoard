import { patchJobTracking, type SavedTracking } from "@/lib/jobs/tracking-client";

type JobStatus = Pick<SavedTracking, "status" | "appliedAt">;

type StatusUpdateCallbacks = {
  onPendingChange: (pending: boolean) => void;
  onChange: (tracking: JobStatus) => void;
  onSaved: (tracking: SavedTracking) => void;
  onError: (error: unknown) => void;
};

export function createJobStatusUpdater(save = patchJobTracking) {
  const pendingJobIds = new Set<string>();

  return async function updateStatus(
    job: JobStatus & { jobId: string },
    status: string,
    callbacks: StatusUpdateCallbacks,
    restoredAppliedAt?: string | null,
  ) {
    // React may not render the disabled select before another event arrives.
    // Claim the job synchronously so neither a second selection nor Undo can race.
    if (pendingJobIds.has(job.jobId)) return;
    pendingJobIds.add(job.jobId);

    const previous = { status: job.status, appliedAt: job.appliedAt };
    const appliedAt = restoredAppliedAt !== undefined
      ? restoredAppliedAt
      : job.appliedAt ?? (status === "APPLIED" ? new Date().toISOString() : null);

    callbacks.onPendingChange(true);
    callbacks.onChange({ status, appliedAt });

    try {
      const tracking = await save(job.jobId, {
        status,
        ...(restoredAppliedAt !== undefined ? { appliedAt: restoredAppliedAt } : {}),
      });
      callbacks.onChange(tracking);
      callbacks.onSaved(tracking);
    } catch (error) {
      callbacks.onChange(previous);
      callbacks.onError(error);
    } finally {
      pendingJobIds.delete(job.jobId);
      callbacks.onPendingChange(false);
    }
  };
}
