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

test("python report extractor emits docling markdown payload fields", () => {
  const source = read(pythonExtractorPath);

  assert.match(
    source,
    /"source"\s*:\s*"docling_markdown"/,
    "Expected extract_report_pdf.py payload source to identify docling markdown extraction.",
  );

  assert.match(
    source,
    /"markdown"\s*:/,
    "Expected extract_report_pdf.py payload to include markdown content for Node handoff.",
  );
});

test("python report extractor uses Docling converter for markdown export", () => {
  const source = read(pythonExtractorPath);

  assert.match(
    source,
    /DocumentConverter/,
    "Expected extract_report_pdf.py to import and use Docling DocumentConverter.",
  );

  assert.match(
    source,
    /export_to_markdown\s*\(/,
    "Expected extract_report_pdf.py to export converted documents to markdown text.",
  );
});
