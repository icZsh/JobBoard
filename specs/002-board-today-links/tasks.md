# Tasks: Today Links to Posting Detail

**Input**: Corrected design documents from `specs/002-board-today-links/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/posting-detail-link.md`, `quickstart.md`

## Phase 1: Source-of-Truth Correction

- [X] T001 Update `specs/002-board-today-links/spec.md` to target posting detail pages instead of Board homepage/card anchors
- [X] T002 Update `specs/002-board-today-links/plan.md`, `research.md`, `data-model.md`, `contracts/posting-detail-link.md`, and `quickstart.md` for the corrected destination
- [X] T003 Update `PRD.md` and `SPEC.md` so Today title links open posting detail pages in new tabs

## Phase 2: TDD Link Contract Correction

- [X] T004 [P] Update `tests/job-links.test.ts` to expect `/jobs/<encoded-job-id>` detail links
- [X] T005 Run `npm run test -- tests/job-links.test.ts` and confirm the corrected test fails against the old `/board#...` behavior
- [X] T006 Implement stable posting detail link helper in `src/lib/jobs/links.ts`
- [X] T007 Run `npm run test -- tests/job-links.test.ts` and confirm the corrected helper passes

## Phase 3: User Story 1 - Open a Today posting detail page (P1)

**Independent Test**: Open Today, click a job title, and verify a new tab opens `/jobs/<job-id>` for the same posting while Today remains intact.

- [X] T008 [US1] Update `src/app/today/today-client.tsx` to use the posting detail link helper for job title links
- [X] T009 [US1] Preserve existing Today actions in `src/app/today/today-client.tsx` so Details, quick status actions, Apply/source link, and resume-tailoring controls remain unchanged
- [X] T010 [US1] Remove unnecessary Board deep-link anchor usage from `src/app/board/board-client.tsx` if it is no longer used by Today
- [X] T011 [US1] Remove unnecessary Board target-card styling from `src/app/globals.css` if it is no longer used

## Phase 4: Polish and Validation

- [X] T012 Run `npm run test -- tests/job-links.test.ts`
- [X] T013 Run `npm run test`
- [X] T014 Run `npm run typecheck`
- [X] T015 Run `npm run lint`
- [X] T016 Run `npm run build`
- [X] T017 Restart JobBoard with `apps restart jobboard --wait 60`
- [X] T018 Verify `http://127.0.0.1:3000/today` renders job title links to `/jobs/<job-id>` and not `/board`
- [X] T019 Mark all completed tasks `[X]` in `specs/002-board-today-links/tasks.md`

## Dependencies

- T003 source-of-truth updates complete before UI behavior ships.
- T004-T005 must fail before T006 implementation.
- T006 must complete before T008.
- T008-T011 complete before validation.

## Parallel Opportunities

- T003 and T004 touch separate files and can be prepared independently.
- Cleanup tasks T010-T011 touch different files after T008 is done.

## Implementation Strategy

1. Correct the Speckit artifacts and source-of-truth docs.
2. Update the helper test first and watch it fail against the old Board deep-link behavior.
3. Implement the corrected detail-link helper.
4. Wire Today to `/jobs/<id>` and remove now-unused Board anchor/highlight code.
5. Run full validation, restart JobBoard, and verify the live port.
