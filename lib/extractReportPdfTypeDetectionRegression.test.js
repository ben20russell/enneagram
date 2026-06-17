import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf reads structured HTML-markdown payload from extract_report_pdf python helper", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /extract_report_pdf\.py/,
    "Expected parsePdf python verification helper to call scripts/extract_report_pdf.py.",
  );

  assert.match(
    source,
    /structured_document|structuredDocument|markdown/,
    "Expected parsePdf python payload normalization to include structured HTML-markdown content.",
  );
});

test("parsePdf prompt requires JSON extraction strictly from repaired HTML report text", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /extract the required JSON strictly from the following repaired HTML report/i,
    "Expected parsePdf prompt payload to strictly scope extraction to repaired HTML report content.",
  );
});
