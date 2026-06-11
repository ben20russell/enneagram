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

test("python report extractor emits a textNoise object in its JSON payload", () => {
  const source = read(pythonExtractorPath);

  assert.match(
    source,
    /"textNoise"\s*:/,
    "Expected extract_report_pdf.py payload to include a textNoise object.",
  );

  assert.match(
    source,
    /"controlNoisePer10kChars"\s*:/,
    "Expected extract_report_pdf.py text noise payload to expose controlNoisePer10kChars.",
  );
});
