import assert from "node:assert/strict";
import test from "node:test";
import { formatDateInput, getLocalDateKey, parseDateInput } from "../src/lib/format";
import {
  buildTrackingPatch,
  mergeSavedTracking,
  toTrackingFormState,
  type TrackingFormState,
} from "../src/lib/jobs/tracking-client";
import { trackingPatchSchema } from "../src/lib/jobs/tracking-validation";

const savedForm: TrackingFormState = {
  status: "INTERESTED",
  notes: "",
  nextAction: "",
  nextActionDate: "",
  appliedAt: "",
  resumePath: "",
  resumeVersion: "",
};

test("shows evening applications on their Pacific calendar day", () => {
  // 5:08pm PDT on Oct 11, after the UTC date has rolled over to Oct 12.
  assert.equal(formatDateInput(new Date("2026-10-12T00:08:15.224Z")), "2026-10-11");
  assert.equal(getLocalDateKey(new Date("2026-10-15T03:29:59.812Z")), "2026-10-14");
  assert.equal(formatDateInput(new Date("2026-10-16T18:33:16.781Z")), "2026-10-16");
  assert.equal(formatDateInput(null), "");
});

test("tracking forms preserve historical date-only values stored at UTC midnight", () => {
  const form = toTrackingFormState({
    status: "APPLIED",
    notes: null,
    nextAction: null,
    nextActionDate: "2026-10-20T00:00:00.000Z",
    appliedAt: "2026-10-11T00:00:00.000Z",
    resumePath: null,
    resumeVersion: null,
  });

  assert.equal(form.nextActionDate, "2026-10-20");
  assert.equal(form.appliedAt, "2026-10-11");

  for (const value of ["2026-01-01", "2026-03-08", "2026-11-01", "2026-12-31"]) {
    assert.equal(formatDateInput(new Date(`${value}T00:00:00.000Z`)), value);
  }
});

test("only exact UTC midnight receives the historical date-only interpretation", () => {
  assert.equal(formatDateInput(new Date("2026-10-20T00:00:00.001Z")), "2026-10-19");
  assert.equal(formatDateInput(new Date("2026-10-20T00:00:01.000Z")), "2026-10-19");
  assert.equal(formatDateInput(new Date("2026-10-20T00:01:00.000Z")), "2026-10-19");
  assert.equal(formatDateInput(new Date("2026-10-20T01:00:00.000Z")), "2026-10-19");
});

test("date inputs round-trip through storage, including DST changes", () => {
  for (const value of ["2026-01-01", "2026-03-08", "2026-10-11", "2026-11-01", "2026-12-31"]) {
    assert.equal(formatDateInput(parseDateInput(value)), value);
  }

  assert.equal(parseDateInput(""), null);
});

test("tracking PATCH accepts date inputs and exact timestamps, and rejects anything else", () => {
  const parsed = trackingPatchSchema.parse({
    appliedAt: "2026-10-12T00:08:15.224Z",
    nextActionDate: "2026-10-20",
  });

  assert.equal(parsed.appliedAt?.toISOString(), "2026-10-12T00:08:15.224Z");
  assert.equal(formatDateInput(parsed.nextActionDate), "2026-10-20");
  assert.equal(trackingPatchSchema.parse({ appliedAt: "" }).appliedAt, null);
  assert.equal(trackingPatchSchema.parse({ appliedAt: null }).appliedAt, null);
  assert.equal(trackingPatchSchema.parse({}).appliedAt, undefined);
  assert.equal(trackingPatchSchema.safeParse({ appliedAt: "Oct 11" }).success, false);
  assert.equal(trackingPatchSchema.safeParse({ nextActionDate: "2026-02-30" }).success, false);
});

test("tracking saves send only the fields that were edited", () => {
  assert.deepEqual(
    buildTrackingPatch({ ...savedForm, notes: "Recruiter call Tuesday" }, savedForm),
    { notes: "Recruiter call Tuesday" },
  );
  assert.deepEqual(
    buildTrackingPatch(
      { ...savedForm, nextActionDate: "" },
      { ...savedForm, nextActionDate: "2026-10-20" },
    ),
    { nextActionDate: null },
  );
  assert.deepEqual(buildTrackingPatch(savedForm, savedForm), {});
});

test("a save refreshes fields another writer changed but keeps edits typed during the save", () => {
  const submitted = { ...savedForm, nextAction: "Follow up" };
  const serverState = toTrackingFormState({
    status: "APPLIED",
    notes: "Applied via Ashby",
    nextAction: "Follow up",
    nextActionDate: null,
    appliedAt: "2026-10-16T00:27:50.394Z",
    resumePath: null,
    resumeVersion: null,
  });

  assert.equal(serverState.appliedAt, "2026-10-15");
  assert.deepEqual(
    mergeSavedTracking({ ...submitted, notes: "still typing" }, submitted, serverState),
    { ...serverState, notes: "still typing" },
  );
});
