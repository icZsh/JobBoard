import assert from "node:assert/strict";
import test from "node:test";
import { getJobDetailHref } from "../src/lib/jobs/links";

test("builds stable posting detail links from internal job ids", () => {
  assert.equal(getJobDetailHref("job_abc123"), "/jobs/job_abc123");
});

test("builds encoded posting detail links for special job ids", () => {
  assert.equal(
    getJobDetailHref("job id/with spaces"),
    "/jobs/job%20id%2Fwith%20spaces",
  );
});
