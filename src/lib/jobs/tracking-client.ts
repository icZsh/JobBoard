import { formatDateInput } from "@/lib/format";

const trackingFormFields = [
  "status",
  "notes",
  "nextAction",
  "nextActionDate",
  "appliedAt",
  "resumePath",
  "resumeVersion",
] as const;

type TrackingFormField = (typeof trackingFormFields)[number];

const dateFields = new Set<TrackingFormField>(["nextActionDate", "appliedAt"]);

export type TrackingFormState = Record<TrackingFormField, string>;

export type TrackingPatch = Partial<Record<TrackingFormField, string | null>>;

export type SavedTracking = {
  status: string;
  notes: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  appliedAt: string | null;
  resumePath: string | null;
  resumeVersion: string | null;
};

/** Sends only edited fields, so a stale tab cannot overwrite what another writer saved. */
export function buildTrackingPatch(
  next: TrackingFormState,
  saved: TrackingFormState,
) {
  const patch: TrackingPatch = {};

  for (const field of trackingFormFields) {
    if (next[field] !== saved[field]) {
      patch[field] = dateFields.has(field) ? next[field] || null : next[field];
    }
  }

  return patch;
}

export function toTrackingFormState(tracking: SavedTracking): TrackingFormState {
  return {
    status: tracking.status,
    notes: tracking.notes ?? "",
    nextAction: tracking.nextAction ?? "",
    nextActionDate: formatDateInput(
      tracking.nextActionDate ? new Date(tracking.nextActionDate) : null,
    ),
    appliedAt: formatDateInput(
      tracking.appliedAt ? new Date(tracking.appliedAt) : null,
    ),
    resumePath: tracking.resumePath ?? "",
    resumeVersion: tracking.resumeVersion ?? "",
  };
}

/** Keeps anything typed while a save was in flight; every other field takes the saved value. */
export function mergeSavedTracking(
  current: TrackingFormState,
  submitted: TrackingFormState,
  saved: TrackingFormState,
) {
  const merged = { ...saved };

  for (const field of trackingFormFields) {
    if (current[field] !== submitted[field]) {
      merged[field] = current[field];
    }
  }

  return merged;
}

export async function patchJobTracking(jobId: string, patch: TrackingPatch) {
  let response: Response;

  try {
    response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/tracking`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    throw new Error("Can't reach the JobBoard server.");
  }

  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    errorMessage?: string;
    tracking?: SavedTracking;
  } | null;

  if (!response.ok || !data?.ok || !data.tracking) {
    throw new Error(
      data?.errorMessage ?? `Request failed (HTTP ${response.status}).`,
    );
  }

  return data.tracking;
}
