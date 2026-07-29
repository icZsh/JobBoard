import assert from "node:assert/strict";
import test from "node:test";
import { getCompanyWebsiteUrl } from "../src/lib/jobs/company-website";
import { importJobSchema } from "../src/lib/import/validation";

test("extracts an official HTTP(S) company website from recommendation data", () => {
  assert.equal(
    getCompanyWebsiteUrl({
      company_website_url: "  https://example.com/company  ",
    }),
    "https://example.com/company",
  );
  assert.equal(
    getCompanyWebsiteUrl({ company_website_url: "http://example.com" }),
    "http://example.com/",
  );
});

test("rejects missing, malformed, and unsafe company website values", () => {
  assert.equal(getCompanyWebsiteUrl(null), null);
  assert.equal(getCompanyWebsiteUrl([]), null);
  assert.equal(getCompanyWebsiteUrl({}), null);
  assert.equal(getCompanyWebsiteUrl({ company_website_url: 42 }), null);
  assert.equal(
    getCompanyWebsiteUrl({ company_website_url: "javascript:alert(1)" }),
    null,
  );
  assert.equal(
    getCompanyWebsiteUrl({ company_website_url: "not a website" }),
    null,
  );
});

test("validates and normalizes imported company website URLs", () => {
  const parsed = importJobSchema.parse({
    title: "Data Engineer",
    company: "Example",
    company_website_url: " https://example.com ",
  });

  assert.equal(parsed.company_website_url, "https://example.com");
  assert.equal(
    importJobSchema.safeParse({
      title: "Data Engineer",
      company: "Example",
      company_website_url: "javascript:alert(1)",
    }).success,
    false,
  );
});
