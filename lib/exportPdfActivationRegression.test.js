import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("export dashboard PDF triggers print without pre-print await boundaries", () => {
  const script = read(reportScriptPath);
  const exportFnMatch = script.match(/async\s+function\s+exportDashboardPdf\s*\(\)\s*\{([\s\S]*?)\n\}/);

  assert.ok(exportFnMatch?.[1], "Expected exportDashboardPdf function body");

  const body = exportFnMatch[1];
  const printIndex = body.indexOf("window.print()");
  const firstAwaitIndex = body.indexOf("await ");

  assert.ok(printIndex >= 0, "Expected exportDashboardPdf to call window.print()");

  if (firstAwaitIndex >= 0) {
    assert.ok(
      printIndex < firstAwaitIndex,
      "Expected window.print() to occur before the first await to preserve user activation",
    );
  }

  assert.doesNotMatch(
    body,
    /await\s+waitForAnimationFrame\s*\(\)/,
    "Expected export flow to avoid animation-frame awaits before print",
  );
});
