import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportRoutePath = path.join(repoRoot, "app", "api", "admin-import", "route.js");
const adminImportReparseRoutePath = path.join(repoRoot, "app", "api", "admin-import", "reparse", "route.js");
const adminImportApplyParsedRoutePath = path.join(repoRoot, "app", "api", "admin-import", "apply-parsed", "route.js");
const adminImportFinalizeLiteRoutePath = path.join(repoRoot, "app", "api", "admin-import", "finalize-lite", "route.js");
const adminReviewRoutePath = path.join(repoRoot, "app", "api", "admin-review", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import routes use report-type min-page resolver instead of fixed 20-page fallback", () => {
  const sourceByPath = {
    [adminImportRoutePath]: read(adminImportRoutePath),
    [adminImportReparseRoutePath]: read(adminImportReparseRoutePath),
    [adminImportApplyParsedRoutePath]: read(adminImportApplyParsedRoutePath),
    [adminImportFinalizeLiteRoutePath]: read(adminImportFinalizeLiteRoutePath),
  };

  for (const [routePath, source] of Object.entries(sourceByPath)) {
    assert.match(
      source,
      /resolveMinExpectedPagesByReportType/,
      `Expected ${routePath} to use report-type min-page resolver.`,
    );
  }

  assert.doesNotMatch(
    sourceByPath[adminImportRoutePath],
    /process\.env\.PDF_PARSE_MIN_PAGES\s*\?\?\s*20/,
    "Expected admin-import route completeness logic to avoid fixed 20-page fallback.",
  );

  assert.doesNotMatch(
    sourceByPath[adminImportReparseRoutePath],
    /process\.env\.PDF_PARSE_MIN_PAGES\s*\?\?\s*20/,
    "Expected reparse route completeness logic to avoid fixed 20-page fallback.",
  );

  assert.doesNotMatch(
    sourceByPath[adminImportApplyParsedRoutePath],
    /process\.env\.PDF_PARSE_MIN_PAGES\s*\?\?\s*20/,
    "Expected apply-parsed route completeness logic to avoid fixed 20-page fallback.",
  );
});

test("admin review save recomputes page threshold from report type before approval status", () => {
  const source = read(adminReviewRoutePath);

  assert.match(
    source,
    /resolveMinExpectedPagesByReportType/,
    "Expected admin-review save path to use report-type page threshold resolver.",
  );

  assert.match(
    source,
    /\.select\("id,results_data,report_pdf"\)/,
    "Expected admin-review save path to load report_pdf metadata for file-name-based thresholding.",
  );

  assert.match(
    source,
    /const\s+minPages\s*=\s*resolveMinExpectedPagesByReportType\(/,
    "Expected admin-review save path to resolve min-pages from report type.",
  );
});
