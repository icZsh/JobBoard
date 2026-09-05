# Tasks: Resume Tailoring

**Input**: Design documents from `specs/001-resume-tailoring/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/tailor-resume-api.md`, `quickstart.md`

## Phase 1: Setup and Source-of-Truth Alignment

- [X] T001 Update `PRD.md` scope language to permit post-V1 resume tailoring while keeping cover letters out of scope
- [X] T002 Update `SPEC.md` environment/runtime notes for Markdown resume path and resume-tailoring configuration
- [X] T003 Update `.env.example` with Markdown `RESUME_FILE_PATH`, `GEMINI_API_KEY`, optional `GOOGLE_API_KEY`, `GEMINI_RESUME_MODEL`, and `TAILORED_RESUME_ROOT`
- [X] T004 Update `CLAUDE.md` environment guidance for Markdown resume path and direct Gemini resume-tailoring configuration
- [X] T005 Add `@google/genai` dependency to `package.json` and `package-lock.json`

## Phase 2: Foundational Tests and Pure Helpers

- [X] T006 [P] Write failing schema/parser tests in `tests/resume-schema.test.ts`
- [X] T007 [P] Write failing output path/version tests in `tests/resume-output.test.ts`
- [X] T008 [P] Write failing input normalization tests in `tests/resume-input.test.ts`
- [X] T009 Create typed resume tailoring errors in `src/lib/resume/errors.ts`
- [X] T010 Implement Gemini response schema/parser in `src/lib/resume/schema.ts`
- [X] T011 Implement output path/version utilities in `src/lib/resume/output.ts`
- [X] T012 Implement input validation/normalization helpers in `src/lib/resume/input.ts`
- [X] T013 Run focused helper tests for `tests/resume-schema.test.ts`, `tests/resume-output.test.ts`, and `tests/resume-input.test.ts`

## Phase 3: User Story 1 - Generate a tailored resume for an active job (P1)

**Independent Test**: Mock provider/filesystem seams, tailor one active job, verify returned path/version and tracking resume fields update without requiring a real provider call.

- [X] T014 [US1] Write failing service happy-path test in `tests/resume-tailor-service.test.ts`
- [X] T015 [US1] Implement prompt builder in `src/lib/resume/prompt.ts`
- [X] T016 [US1] Implement Gemini adapter in `src/lib/resume/gemini-client.ts`
- [X] T017 [US1] Implement tailoring service orchestration in `src/lib/resume/tailor-service.ts`
- [X] T018 [US1] Add `POST /api/jobs/[id]/tailor-resume` route in `src/app/api/jobs/[id]/tailor-resume/route.ts`
- [X] T019 [US1] Update `TrackingForm` in `src/app/jobs/[id]/tracking-form.tsx` with active-status `Tailor resume` button and success handling
- [X] T020 [US1] Run focused service/helper tests in `tests/resume-tailor-service.test.ts` and related resume tests

## Phase 4: User Story 2 - Display warnings and changes (P2)

**Independent Test**: Mock a successful generation with warnings/changes and verify the API response and tracking panel state can display them.

- [X] T021 [US2] Add service/API test coverage for warnings and changes in `tests/resume-tailor-service.test.ts`
- [X] T022 [US2] Render warning and change cards in `src/app/jobs/[id]/tracking-form.tsx`
- [X] T023 [US2] Run focused warnings/change tests in `tests/resume-tailor-service.test.ts`

## Phase 5: User Story 3 - Fail safely (P3)

**Independent Test**: Configure invalid prerequisites or mocked provider failures and verify typed errors map to safe responses with no resume field mutation.

- [X] T024 [US3] Add failing tests for invalid resume path, missing context, invalid provider JSON, and duplicate output safety in `tests/resume-tailor-service.test.ts` and helper tests
- [X] T025 [US3] Harden service error handling and cleanup behavior in `src/lib/resume/tailor-service.ts`
- [X] T026 [US3] Add route status mapping by `ResumeTailoringError.code` in `src/app/api/jobs/[id]/tailor-resume/route.ts`
- [X] T027 [US3] Render concise inline error state in `src/app/jobs/[id]/tracking-form.tsx`
- [X] T028 [US3] Run focused failure-path tests in `tests/resume-tailor-service.test.ts` and helper tests

## Phase 6: Polish and Validation

- [X] T029 Verify Spec Kit checklists are complete in `specs/001-resume-tailoring/checklists/requirements.md`
- [X] T030 Run `npm run typecheck`
- [X] T031 Run `npm run lint`
- [X] T032 Run `npm run build`
- [X] T033 Run `npm run test` or document exact local Postgres prerequisite if environment blocks full integration tests
- [X] T034 Update `specs/001-resume-tailoring/tasks.md` so all completed tasks are marked `[X]`

## Phase 7: Today Page Shortcut Follow-up

- [X] T035 [US1] Share the active-status resume-tailoring eligibility rule so Today and Job Detail stay consistent
- [X] T036 [US1] Add `Tailor resume` to the Today page expanded Details area with inline loading/success/warning/change/error feedback
- [X] T037 [US1] Include existing resume path/version in Today item data so generated or existing resume metadata can be shown after tailoring
- [X] T038 [US1] Run focused rule tests, typecheck, lint, build, full tests, and browser verification for the Today shortcut

## Dependencies

- Setup/source docs (T001-T005) should complete before implementation behavior ships.
- Foundational tests (T006-T008) must be written before pure helper implementation (T009-T012).
- Helper tests passing (T013) blocks service implementation confidence.
- US1 (T014-T020) is the MVP and must complete before US2/US3 polish.
- US2 depends on US1 success response shape.
- US3 depends on service and route structure from US1.
- Validation tasks run after implementation tasks.
- Today page shortcut tasks T035-T038 depend on the original resume-tailoring route/service from US1 and reuse the same POST contract.

## Parallel Opportunities

- T006, T007, and T008 can be written in parallel because they touch separate test files.
- T009, T010, T011, and T012 should be sequenced by test feedback but are mostly independent helper files.
- Documentation tasks T001-T004 touch different files and can be reviewed independently.
- T035 can be validated independently from Today UI rendering because it is a shared pure eligibility rule.

## Implementation Strategy

1. Ship source-of-truth alignment and helper tests first.
2. Implement pure helpers under `src/lib/resume/` with strict TDD.
3. Add service orchestration with injected seams so tests avoid real provider calls and real Jobs vault writes.
4. Add the route and sidebar UI only after service behavior is verified.
5. Finish with full typecheck/lint/build and document any environment-bound integration test limits.
