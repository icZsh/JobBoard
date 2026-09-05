# Data Model: Today Links to Posting Detail

No schema migration is required. The feature uses existing JobBoard entities and derives a detail URL from the stable job id already exposed to Today and Job Detail UI components.

## Entity: Today Job Card

**Purpose**: Daily review card for a job recommendation in the selected import run.

**Relevant fields**:

- `jobId`: Stable internal job identity. Required for posting detail link generation.
- `title`: Display text rendered as the clickable label.
- `company`, `location`, `status`, recommendation fields: Existing display and filtering fields, unchanged.

**Validation rules**:

- The detail link must be derived from `jobId`, not `title`, `company`, or `sourceUrl`.
- The external source/apply URL remains separate from the title-to-detail link.

## Entity: Posting Detail Page

**Purpose**: Detail workspace for one JobBoard posting.

**Relevant fields**:

- `id`: Same stable internal job identity used by Today `jobId`.
- Listing fields, recommendation context, and tracking fields already displayed by `/jobs/<id>`.

**Validation rules**:

- A Today title link must target the matching detail route for `jobId`.
- Existing detail page behavior remains unchanged.

## Derived Entity: Posting Detail Link

**Purpose**: Internal navigation target from a Today job title to its matching posting detail page.

**Fields**:

- `href`: Detail path derived from the stable internal job id.

**Validation rules**:

- Must encode job ids safely for URL path segments.
- Must be deterministic: the same job id always produces the same detail link.
