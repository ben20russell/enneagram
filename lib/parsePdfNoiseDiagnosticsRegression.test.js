import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");
const pythonExtractorPath = path.join(repoRoot, "scripts", "extract_report_pdf.py");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf normalizes python text-noise payload into verification diagnostics", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /textNoise:/,
    "Expected parsePdf python verification normalization to include textNoise fields.",
  );
});

test("parsePdf writes parse noise summary into _parseDiagnostics", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /_parseDiagnostics:\s*\{[\s\S]*noise:/,
    "Expected parsePdf diagnostics payload to include a top-level noise summary.",
  );
});

test("python report extractor emits layout_html_markdown payload fields", () => {
  const source = read(pythonExtractorPath);

  assert.match(
    source,
    /SOURCE_LABEL\s*=\s*"layout_html_markdown"/,
    "Expected extract_report_pdf.py payload source to identify layout_html_markdown extraction.",
  );

  assert.match(
    source,
    /"structured_document"\s*:/,
    "Expected extract_report_pdf.py payload to include structured_document content for Node handoff.",
  );
});

test("python report extractor uses pymupdf4llm + HTML table normalization", () => {
  const source = read(pythonExtractorPath);

  assert.match(
    source,
    /pymupdf4llm/,
    "Expected extract_report_pdf.py to import and use pymupdf4llm.",
  );

  assert.match(
    source,
    /ensure_html_tables\s*\(/,
    "Expected extract_report_pdf.py to normalize converted markdown table blocks into HTML text.",
  );
});
