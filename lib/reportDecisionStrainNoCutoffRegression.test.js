import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("decision strain focused copy uses expanded max length in structured report extraction", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /decisionStrainCopy:\s*extractSpreadsheetSnippetFromText\(\s*decisionStrainInstructionText\s*\|\|\s*decisionText\s*,[\s\S]*?\,\s*2000\s*\)/,
    "Expected structured decision strain extraction to use a larger max length to avoid clipping the final sentence.",
  );
});

test("decision strain focused copy uses expanded max length in fallback PDF extraction", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /decisionStrainCopy:\s*extractSpreadsheetSnippetFromText\(\s*normalized\s*,[\s\S]*?\,\s*2000\s*\)/,
    "Expected fallback decision strain extraction to use a larger max length to avoid clipping the final sentence.",
  );
});
