import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("adaptive/example fallback copy is explicitly gated to example mode", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /const\s+spreadsheetFocusFallbacks\s*=\s*isExampleMode\s*\?\s*buildSpreadsheetFocusFallbacks\(\s*REPORT\s*,\s*adaptiveCopy\s*\)\s*:\s*\{\s*\}\s*;/,
    "Expected spreadsheet focus fallbacks to be available only in example mode.",
  );

  assert.match(
    script,
    /const\s+teamStageFallbacks\s*=\s*isExampleMode\s*\?\s*\(\s*adaptiveCopy\?\.teamStages\s*\|\|\s*\{\s*\}\s*\)\s*:\s*\{\s*\}\s*;/,
    "Expected team stage fallbacks to be available only in example mode.",
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
