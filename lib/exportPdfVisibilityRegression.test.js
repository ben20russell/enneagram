import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("signed-in users get export enabled while report-active refresh is resolving", () => {
  const script = read(reportScriptPath);
  const signedInBlock = script.match(/function\s+setSignedInAuthUi\s*\(user\)\s*\{([\s\S]*?)\n\}/);

  assert.ok(signedInBlock?.[1], "Expected setSignedInAuthUi function block");
  assert.match(
    signedInBlock[1],
    /setExportPdfState\(\{\s*visible:\s*true,\s*enabled:\s*true\s*\}\);/,
    "Expected signed-in UI to keep Export PDF enabled",
  );
});

test("report-active refresh enables export when assigned report is present or example reports are visible", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /const\s+canExportDashboardPdf\s*=\s*Boolean\(data\?\.isAuthenticated\)\s*&&\s*\(\s*Boolean\(hasAssignedReportAvailable\)\s*\|\|\s*Boolean\(shouldShowExampleReports\)\s*\);/,
    "Expected export availability to include assigned reports and visible examples",
  );

  assert.match(
    script,
    /setExportPdfState\(\{\s*visible:\s*true,\s*enabled:\s*canExportDashboardPdf\s*\}\);/,
    "Expected refresh path to use canExportDashboardPdf state",
  );
});
