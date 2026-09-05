# Feature Specification: Today Links to Posting Detail

**Feature Branch**: `002-board-today-links`

**Created**: 2026-06-13

**Status**: Draft — corrected destination after user feedback

**Input**: User clarification: "我希望跳转到的是这个 posting 在 board 里的详情页，现在是跳转到 board 的首页，不符合预期哈。" The Today job-title link should open the posting's Job Board detail page in a new tab, not the Board pipeline homepage or a Board-card anchor.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a Today posting detail page (Priority: P1)

Isaac reviews the Job Board Today list and can click a job title to open that posting's Job Board detail page in a new browser tab, keeping the Today review list untouched in the original tab.

**Why this priority**: This is the corrected expected workflow: Isaac wants the posting detail workspace for the selected job, not the generic Board page.

**Independent Test**: Can be fully tested by opening Today, clicking a job title, and verifying a new tab opens `/jobs/<job-id>` for the same posting while the original Today tab remains available.

**Acceptance Scenarios**:

1. **Given** Today shows one or more job cards, **When** Isaac clicks a job title, **Then** a new tab opens that same posting's Job Board detail page.
2. **Given** Isaac has filters, sorting, hidden-status visibility, or expanded details in Today, **When** he clicks a job title, **Then** the Today page remains in the original tab with its current review context intact.
3. **Given** a job appears in Today with any tracking status, including hidden statuses when included, **When** the job title is clicked, **Then** the destination uses the stable internal job id and opens the app's posting detail page rather than the external source listing or the Board homepage.

---

### Edge Cases

- If the selected job no longer exists by the time the new tab opens, the app's normal detail not-found behavior should apply without breaking Today.
- If a job title contains special characters, the link target must still identify the correct job by stable job identity rather than title text.
- If the browser blocks or changes new-tab behavior, the link should still be a normal navigable URL that can be opened manually.
- The title link must not replace the existing external Apply/source action.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Today view MUST render each visible job title as a hyperlink to that same job's Job Board detail page.
- **FR-002**: The title hyperlink MUST open in a new tab or equivalent new browsing context by default.
- **FR-003**: The hyperlink target MUST identify the job by stable internal job identity, not by display title, company, or source URL.
- **FR-004**: Opening the hyperlink MUST preserve the original Today tab and its current review state.
- **FR-005**: The title hyperlink MUST route to the app's posting detail page, not the Board pipeline homepage, Board-card anchor, or external employer/source URL.
- **FR-006**: The detail-link behavior MUST NOT change Today status quick actions, Details expansion, Apply/source listing links, resume-tailoring actions, or Board status movement.

### Key Entities *(include if feature involves data)*

- **Today Job Card**: A daily recommendation card containing a stable job identity, title, status, and recommendation context.
- **Posting Detail Page**: The Job Board app page for one stable job identity, including listing details, recommendation context, tracking fields, and resume-tailoring controls.
- **Posting Detail Link**: A navigable target from Today to the matching posting detail page.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of Today job titles render as navigable links to `/jobs/<job-id>` for the same internal job.
- **SC-002**: Clicking a Today job title opens a separate tab or equivalent new browsing context, leaving the original Today tab available.
- **SC-003**: In manual validation with at least three visible Today jobs, each title link lands on that posting's detail page, not `/board`.
- **SC-004**: Existing Today actions and Board status movement continue to work after the change, with no regression in automated tests, typecheck, lint, and build.

## Assumptions

- "posting 在 board 里的详情页" means the existing JobBoard internal detail route for one posting (`/jobs/<job-id>`).
- Isaac is the only user and runs JobBoard locally under the existing local-only trust model.
- A stable job id is already available to Today cards and detail pages.
- No database schema change is needed; this is a navigation/UI affordance over existing job records.
