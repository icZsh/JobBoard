# Research: Today Links to Posting Detail

## Decision: Use existing posting detail routes for Today title links

**Rationale**: User feedback clarified that the desired target is the selected posting's detail page inside JobBoard, not the Board pipeline homepage. The existing `/jobs/<job-id>` route already provides the detail workspace with listing context, recommendation data, tracking fields, and resume-tailoring controls. Linking directly to it is simpler and matches expectation.

**Alternatives considered**:

- `/board#job-<id>`: Implemented first, but user clarified this lands on the Board homepage/pipeline rather than the posting detail page he expected.
- `/board?jobId=<id>` with client-side scroll: Same mismatch; still Board pipeline, not detail.
- External source URL: Already covered by the existing `Apply` action and should stay separate.

## Decision: Share detail-link generation in a pure helper

**Rationale**: Today title links and Board card title links should use one stable convention for internal posting detail URLs. A helper makes the id encoding behavior testable and prevents title/company/source URL from creeping into identity matching.

**Alternatives considered**:

- Inline `/jobs/${id}` construction in components: Small but brittle; tests should cover special job ids and keep URL behavior explicit.
- Database field for detail URL: Unnecessary because the URL is derived from existing stable id.

## Decision: Use `target="_blank"` on the Today title link

**Rationale**: The original request still requires a new tab. Next.js Link supports ordinary anchor attributes such as `target="_blank"`; this preserves Today review state.

**Alternatives considered**:

- `window.open()` click handler: Less accessible, harder to test, and unnecessary for a normal link.
- Same-tab navigation: Faster but loses Today review context and contradicts the requested workflow.
