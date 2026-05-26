import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("signed-in auth UI only shows Example Report switch for admins", () => {
  const script = read(reportScriptPath);
  const signedInBlock = script.match(/function\s+setSignedInAuthUi\s*\(user\)\s*\{([\s\S]*?)\n\}/);

  assert.ok(signedInBlock?.[1], "Expected setSignedInAuthUi function block");
  assert.match(
    signedInBlock[1],
    /setReportSwitchVisible\(hasAdminAccess\(user\?\.email\)\)/,
    "Expected non-admin signed-in users to have Example Report switch hidden",
  );
});

test("report-active refresh gates Example Report switch by admin login only", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /const\s+shouldShowExampleReports\s*=\s*!Boolean\(data\?\.isAuthenticated\)\s*\|\|\s*isAdmin;/,
    "Expected Example Report switch visibility to require admin when authenticated",
  );
});

test("assigned report defaults selector to My Report without admin-only condition", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /if\s*\(hasAssignedReportAvailable\)\s*\{[\s\S]*?currentReportViewMode\s*=\s*"my-report";[\s\S]*?selectMyReportInSelector\(\);/,
    "Expected assigned report flow to default selector to My Report",
  );

  assert.doesNotMatch(
    script,
    /if\s*\(isReady\s*&&\s*isAdmin\)\s*\{\s*currentReportViewMode\s*=\s*"my-report";\s*selectMyReportInSelector\(\);\s*\}/,
    "Expected My Report default to not be restricted to admin-only condition",
  );
});
