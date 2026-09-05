# Contract: Today Posting Detail Link

## Purpose

Define the internal navigation contract from a Job Board Today card to the matching posting detail page inside JobBoard.

## Link shape

```text
/jobs/<encoded-job-id>
```

- `encoded-job-id` is derived from the stable internal job id.
- The link is internal to JobBoard and does not use the employer/source URL.
- The link must not point to `/board` or a Board-card fragment.

## Today title link behavior

For every visible Today job card:

- The job title is rendered as a navigable link.
- The link target uses the matching job's stable internal id.
- The link opens in a new browsing context by default.
- The link preserves the existing external Apply/source action separately.

## Posting detail behavior

For the target detail page:

- The existing JobBoard detail page loads for the selected job id.
- Existing tracking, recommendation context, and resume-tailoring behavior remain unchanged.
- If the job id is not found, the app's normal detail not-found behavior applies.

## Safety and compatibility

- This contract does not add or change database fields.
- This contract does not add or change API endpoints.
- This contract does not change tracking/status write semantics.
- This contract must support job ids containing characters that require URL path-segment encoding.
