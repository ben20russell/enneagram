import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");
const reportHtmlPath = path.join(repoRoot, "public", "report.html");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("report diagnostics snapshot includes explicit page and type-score verification row", () => {
  const html = read(reportHtmlPath);
  assert.match(
    html,
    /id="extractedVerificationValue"[^>]*>Detected pages: Not available · Type scores populated: 0\/9</,
    "Expected Extracted Content Snapshot to include explicit page/type-score verification line",
  );
});

test("data quality diagnostics summary includes detected pages and type score coverage", () => {
  const script = read(reportScriptPath);
  assert.match(
    script,
    /Detected pages:\s*\$\{[^}]+\}/,
    "Expected diagnostics summary to include detected page count",
  );
  assert.match(
    script,
    /Type scores populated:\s*\$\{[^}]+\}\/\$\{[^}]+\}/,
    "Expected diagnostics summary to include type score population coverage",
  );
  assert.match(
    script,
    /setText\(\s*'extractedVerificationValue'/,
    "Expected report renderer to populate extracted verification snapshot line",
  );
});
