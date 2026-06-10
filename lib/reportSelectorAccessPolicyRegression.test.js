import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("signed-in auth UI still computes admin gating for dormant Example Report switch", () => {
  const script = read(reportScriptPath);
  const signedInBlock = script.match(/function\s+setSignedInAuthUi\s*\(user\)\s*\{([\s\S]*?)\n\}/);

  assert.ok(signedInBlock?.[1], "Expected setSignedInAuthUi function block");
  assert.match(
    signedInBlock[1],
    /setReportSwitchVisible\(hasAdminAccess\(user\?\.email\)\)/,
    "Expected non-admin signed-in users to have Example Report switch hidden",
  );
});

test("report-active refresh still computes Example Report visibility policy", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /const\s+shouldShowExampleReports\s*=\s*!Boolean\(data\?\.isAuthenticated\)\s*\|\|\s*isAdmin;/,
    "Expected Example Report switch visibility to require admin when authenticated",
  );
});

test("client-report selection is prioritized over assigned report fallback during refresh", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /if\s*\(currentClientReportId\)\s*\{[\s\S]*?latestAdminClientReportsById\.get\([\s\S]*?currentClientReportId[\s\S]*?\)[\s\S]*?currentReportViewMode\s*=\s*"client-report";[\s\S]*?ingestAssignedReportIntoDashboard\(selectedClientReport\);[\s\S]*?return;/,
    "Expected refresh flow to prioritize currently selected client report before falling back to assigned report.",
  );

  assert.match(
    script,
    /if\s*\(hasAssignedReportAvailable\)\s*\{[\s\S]*?currentReportViewMode\s*=\s*"assigned-report";[\s\S]*?ingestAssignedReportIntoDashboard\(data\);/,
    "Expected assigned report fallback mode to remain available when no client report is selected.",
  );
});

test("logged-in users without assigned reports default to example Type 3 on first load", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /const\s+DEFAULT_EXAMPLE_REPORT_TYPE\s*=\s*"3"\s*;/,
    "Expected a fixed default example report type of 3.",
  );

  assert.match(
    script,
    /function\s+applyRandomExampleReport\s*\(\)\s*\{[\s\S]*?reportSelector\.value\s*=\s*DEFAULT_EXAMPLE_REPORT_TYPE;[\s\S]*?applyReport\(DEFAULT_EXAMPLE_REPORT_TYPE\);/,
    "Expected first-load example application to use the Type 3 default value.",
  );

  assert.doesNotMatch(
    script,
    /Math\.floor\(Math\.random\(\)\s*\*\s*9\)\s*\+\s*1/,
    "Expected random example-type selection logic to be removed.",
  );

  assert.match(
    script,
    /if\s*\(hasAssignedReportAvailable\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?if\s*\(currentReportViewMode\s*!==\s*"example"\)\s*\{[\s\S]*?applySelectedExampleReportOrFallback\(\);[\s\S]*?\}\s*else if\s*\(!exampleReportInitialized\)\s*\{[\s\S]*?applyRandomExampleReport\(\);/,
    "Expected no-assigned-report path to keep using the first-load example initialization branch.",
  );
});
