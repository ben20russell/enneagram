import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("assigned-report hydration does not use adaptive/example fallback copy for spreadsheet focus and team stages", () => {
  const script = read(reportJsPath);

  assert.doesNotMatch(
    script,
    /const\s+spreadsheetFocusFallbacks\s*=/,
    "Expected assigned-report hydration to avoid spreadsheet focus fallback objects.",
  );

  assert.doesNotMatch(
    script,
    /const\s+teamStageFallback\s*=/,
    "Expected assigned-report hydration to avoid team stage fallback objects.",
  );
});

test("missing assigned-report strain narrative text resolves to explicit not-detected copy", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+getStrainCardFallbackText\s*\([^)]*\)\s*\{\s*return\s+"Not detected in assigned PDF\."\s*;\s*\}/,
    "Expected missing strain narrative fallback to return exact assigned-PDF not-detected copy.",
  );
});
