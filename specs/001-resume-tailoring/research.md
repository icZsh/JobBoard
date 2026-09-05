# Research: Resume Tailoring

## Decision: Use direct Gemini API from the JobBoard server

**Rationale**: Resume tailoring is a bounded text-in / JSON-out task. A narrow server-side adapter keeps API key use, retry behavior, timeout handling, response parsing, and typed errors inside JobBoard. This mirrors the existing Morning Market Brief pattern without inheriting its faster/lower-quality model choice.

**Alternatives considered**:

- **Hermes CLI / agent process**: Rejected for V1. It adds stdout parsing, PATH/profile issues, launchd environment friction, and agent nondeterminism for a task that does not need autonomous behavior.
- **Template-only deterministic generator**: Rejected. It would likely produce weaker resumes and more manual cleanup.
- **Background queue/worker**: Rejected. One explicit click per job is enough for local single-user V1.

## Decision: Require Markdown/plain-text base resume for V1

**Rationale**: Isaac already has a Markdown resume path. Reading Markdown as UTF-8 is simple, auditable, and testable. PDF/Office parsing would add brittle dependencies and a second class of extraction errors before the core workflow proves useful.

**Alternatives considered**:

- **Accept PDF paths**: Deferred. Useful later, but it would require extraction quality checks and a user-visible preview path.
- **File upload/storage**: Rejected. JobBoard already stores local resume paths and should not become a file manager.

## Decision: Strict JSON response contract with schema validation

**Rationale**: Provider output must be validated before it is trusted. Strict JSON separates the tailored Markdown from warnings/changes and gives the route stable behavior for success/failure handling.

**Alternatives considered**:

- **Accept raw Markdown directly**: Rejected because warnings and changes would become hard to parse and invalid model output could be mistaken for success.
- **Try to salvage malformed responses**: Rejected beyond a single harmless outermost-object fallback. Strictness is safer than clever recovery.

## Decision: App owns output path and persistence

**Rationale**: The provider must not choose filesystem paths or mutate database state. JobBoard can generate predictable timestamped paths under the configured root, check containment, avoid overwrites, write the file, and then update tracking metadata.

**Alternatives considered**:

- **Let provider return filename/path**: Rejected. External text should not control local filesystem writes.
- **Store resume content in Postgres**: Rejected for V1. Markdown files in the Jobs vault are easier to inspect and naturally preserve history.

## Decision: Reuse existing `job_tracking` resume fields, no new table

**Rationale**: `resumePath` and `resumeVersion` already exist and the V1 user need is the latest generated resume attached to a job. Timestamped files preserve prior outputs without first-class history UI.

**Alternatives considered**:

- **ResumeVersion table**: Deferred until Isaac needs browsing, diffing, or explicit history management.
- **Cover-letter metadata fields**: Rejected by scope lock.

## Decision: Inline tracking panel UX

**Rationale**: Resume tailoring is a tracking action for the current job. Inline feedback keeps context visible, avoids a modal interruption, and keeps V1 small.

**Alternatives considered**:

- **Modal flow**: Rejected. It adds state and interrupts review without adding value in V1.
- **Separate resume workbench/page**: Rejected. That is a later product once generation proves useful.
- **Embedded Markdown preview/editor**: Deferred. The saved file in the vault is the review/edit surface for V1.

## Decision: Protect unsaved tracking edits on UI success

**Rationale**: The tailoring route persists only resume path/version. If the client copied the whole current form into `lastSaved`, unsaved notes/next-action edits could be falsely marked as saved. The UI must update only resume fields in both `form` and `lastSaved`.

**Alternatives considered**:

- **Auto-save the entire tracking form before tailoring**: Rejected for V1 because it couples two actions and can unexpectedly persist draft notes.
- **Disable tailoring whenever any field is dirty**: Acceptable but more friction. The preferred V1 is to allow tailoring while preserving dirty state correctly.
