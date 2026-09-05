# Feature Specification: Resume Tailoring

**Feature Branch**: `001-resume-tailoring`

**Created**: 2026-06-11

**Status**: Draft

**Input**: User description: "Add a Tailor resume action to JobBoard job detail tracking panel that uses the configured Markdown base resume plus selected job recommendation context to generate a job-specific Markdown resume, write it under the Jobs vault, update tracking resume path/version, display warnings/errors inline, and keep V1 resume-only. Follow-up: also expose Tailor resume in the Today page's expanded Details area so Isaac can tailor directly from daily review."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a tailored resume for an active job (Priority: P1)

Isaac opens an active job detail page and generates a job-specific resume from his configured base resume and the job's recommendation context. The app saves the generated Markdown file, updates the job's resume path/version, and shows the saved result in the tracking panel.

**Why this priority**: This is the core value: reduce manual resume tailoring work for a job Isaac is preparing to apply to.

**Independent Test**: Can be fully tested by opening an active job with recommendation context, clicking `Tailor resume`, and verifying that a saved Markdown resume path/version appears on that job without changing unrelated tracking fields.

**Acceptance Scenarios**:

1. **Given** a job with status Interested, Applying, Applied, or Interviewing and a configured Markdown base resume, **When** Isaac clicks `Tailor resume`, **Then** the app creates a job-specific Markdown resume and updates only that job's resume path and resume version.
2. **Given** Isaac has unsaved notes or next-action edits in the tracking panel, **When** resume tailoring succeeds, **Then** the generated resume fields update without falsely marking those unrelated edits as saved.
3. **Given** the generated resume is saved, **When** Isaac reviews the tracking panel, **Then** the panel shows the generated version, saved path, and a clear success state.
4. **Given** Isaac is reviewing jobs on the Today page and expands a job's Details area, **When** that job is in an active tailoring status, **Then** he can click `Tailor resume` there without first navigating to the full job detail page.

---

### User Story 2 - See risks and warnings before using the generated resume (Priority: P2)

Isaac can see concise warnings or change notes returned by the tailoring process, especially when the job requests experience not clearly supported by the base resume.

**Why this priority**: Resume generation is risky if it invents claims. Warnings preserve trust and prompt manual review where needed.

**Independent Test**: Can be tested with a generation result containing warnings and changes; the tracking panel displays them inline without hiding the saved resume path.

**Acceptance Scenarios**:

1. **Given** the tailoring process returns warnings, **When** the resume is generated, **Then** the tracking panel displays the warnings near the generated resume result.
2. **Given** the tailoring process returns a change summary, **When** the resume is generated, **Then** the tracking panel displays the changes in a concise reviewable format.

---

### User Story 3 - Fail safely when prerequisites are missing or invalid (Priority: P3)

Isaac receives clear inline errors when resume tailoring cannot run, and failed attempts do not mutate resume tracking fields or write misleading state.

**Why this priority**: The feature touches private resume content, external generation, filesystem writes, and tracking metadata. Failures must be understandable and safe.

**Independent Test**: Can be tested by configuring missing or invalid resume prerequisites and confirming that the UI shows an error while existing resume path/version remain unchanged.

**Acceptance Scenarios**:

1. **Given** no base resume path is configured, **When** Isaac clicks `Tailor resume`, **Then** the app shows a clear configuration error and leaves tracking fields unchanged.
2. **Given** the configured base resume is a PDF, Office document, image, binary file, or unreadable file, **When** Isaac clicks `Tailor resume`, **Then** the app rejects the request before generation and explains that Markdown/plain text is required.
3. **Given** the selected job has neither job description nor recommendation context, **When** Isaac clicks `Tailor resume`, **Then** the app shows a clear context error and does not update resume path/version.
4. **Given** generation or saving fails, **When** Isaac receives the error, **Then** the tracking panel shows a concise error and does not present stale generated state as success.

---

### Edge Cases

- Jobs in New, Rejected, Passed, Archived, or Offer status should not show the tailoring action in V1.
- Job descriptions may contain HTML or instructions from outside sources; these must not override app rules or tailoring constraints.
- Generated resumes must not claim unverifiable experience, credentials, dates, companies, tools, or metrics that are not supported by Isaac's base resume.
- Duplicate filenames must not overwrite existing tailored resumes.
- Very long base resumes or job descriptions should be bounded so a single job cannot create an excessive generation request.
- A saved Markdown file and tracking metadata can fail at different moments; the app must avoid reporting a complete success unless tracking fields are updated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST show a `Tailor resume` action on job detail tracking panels and Today page expanded Details areas only for active application statuses: Interested, Applying, Applied, and Interviewing.
- **FR-002**: The system MUST use the configured base resume path as the resume source and MUST require the source resume to be Markdown or plain text for V1.
- **FR-003**: The system MUST combine the base resume with selected job context, including available job description and latest recommendation context, to produce one tailored Markdown resume.
- **FR-004**: The system MUST keep V1 resume-only: no cover-letter generation, cover-letter tracking fields, batch generation, PDF export, or resume history table.
- **FR-005**: The system MUST save generated resumes under the configured Jobs resume area using a readable, timestamped filename that avoids overwriting existing files.
- **FR-006**: The system MUST update the selected job's resume path and resume version after a successful generation and save.
- **FR-007**: The system MUST update only resume path/version when generation succeeds and MUST preserve any unrelated unsaved tracking edits.
- **FR-008**: The system MUST display a concise success result with generated resume path/version after completion.
- **FR-009**: The system MUST display generation warnings and change summaries when available.
- **FR-010**: The system MUST display clear inline errors for missing configuration, unreadable or non-text resumes, missing job context, generation failure, invalid generated output, file write failure, or tracking update failure.
- **FR-011**: The system MUST NOT mutate resume path/version when prerequisite validation or generation fails.
- **FR-012**: The system MUST treat job descriptions and recommendation text as untrusted context and MUST prevent them from overriding resume-tailoring rules.
- **FR-013**: The system MUST validate generated output before saving or presenting it as successful.
- **FR-014**: The system MUST keep secrets and provider credentials out of the database, generated resume files, prompts displayed to users, and user-visible error messages.
- **FR-015**: The system MUST document the post-V1 scope change so project source-of-truth docs permit resume tailoring while keeping cover letters out of scope.
- **FR-016**: The Today page `Tailor resume` action MUST use the same resume-tailoring workflow and show inline loading, success, warning/change, and error feedback within the expanded Details area.

### Key Entities *(include if feature involves data)*

- **Base Resume**: Isaac's configured Markdown/plain-text resume source. It is referenced by local path and read only for the tailoring request.
- **Selected Job**: The job detail currently being viewed, including listing fields and latest recommendation context.
- **Tailored Resume**: A generated Markdown file saved under the Jobs resume area with a readable version label and path.
- **Tracking Resume Metadata**: The resume path and resume version fields on Isaac's personal tracking state for a job.
- **Tailoring Feedback**: Warnings and changes produced with the tailored resume for manual review.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Isaac can generate a tailored resume for an active job from either the job detail page or the Today page's expanded Details area in one click after prerequisites are configured.
- **SC-002**: 100% of successful generation attempts display the saved resume path and version in the tracking panel.
- **SC-003**: 100% of failed prerequisite checks leave existing resume path/version unchanged and show a human-readable error.
- **SC-004**: Generated resume filenames are unique across repeated clicks for the same job within the same day.
- **SC-005**: The feature can be validated without calling a real external generation provider by using test doubles for generation and filesystem writes.
- **SC-006**: Project source-of-truth docs no longer contradict the feature: resume tailoring is allowed, while cover letters remain excluded.

## Assumptions

- Isaac is the only user and runs JobBoard locally under the existing local-only trust model.
- The base resume for V1 is Markdown/plain text; PDF parsing is intentionally deferred.
- A third-party generation provider may process resume text and job context when Isaac clicks the action.
- Timestamped files are enough history for V1; first-class resume version browsing can wait.
- The tailored resume should remain clean Markdown without embedded metadata comments.
