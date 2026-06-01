import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("report-active API exposes assigned-report availability independently from ready state", () => {
  const routeSource = read(path.join(repoRoot, "app", "api", "report-active", "route.js"));

  assert.match(routeSource, /hasAssignedReport:\s*hasAssignedPdfMetadata/, "Expected hasAssignedReport flag in success response");
  assert.match(routeSource, /isAssignedReportReady:\s*isReportActive/, "Expected explicit isAssignedReportReady flag in success response");
  assert.match(routeSource, /hasAssignedReport:\s*false/, "Expected fallback responses to include hasAssignedReport: false");
});

test("dashboard uses assigned-report availability to ingest assigned payload without My Report selector option", () => {
  const reportHtml = read(path.join(repoRoot, "public", "report.html"));
  const reportScript = read(path.join(repoRoot, "public", "report.js"));

  assert.doesNotMatch(
    reportHtml,
    /id="reportSelectorMyReportOption"/,
    "Expected My Report option to be removed from the Example Reports selector.",
  );

  assert.match(reportScript, /function\s+isAssignedReportAvailable\s*\(/, "Expected assigned-report availability helper");
  assert.match(
    reportScript,
    /if\s*\(hasAssignedReportAvailable\)\s*\{[\s\S]*ingestAssignedReportIntoDashboard\(data\)/,
    "Expected ingestion path to run when assigned report is available",
  );
  assert.match(
    reportScript,
    /currentReportViewMode\s*=\s*"assigned-report"/,
    "Expected assigned-report mode to be used instead of My Report selector mode.",
  );
});
