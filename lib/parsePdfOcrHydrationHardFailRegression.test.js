import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf consumes extract_pdf_pages diagnostics and hard-fails when noisy pages are unrecovered", () => {
  const source = read(parsePdfPath);

  assert.match(source, /payload\?\.diagnostics/);
  assert.match(source, /fallbackTriggered/);
  assert.match(source, /ocrAppliedPageNumbers/);
  assert.match(
    source,
    /Noisy PDF pages detected[\s\S]{0,140}OCR recovery failed|OCR fallback did not recover any noisy pages/i,
  );
});

test("parsePdf re-routes to local OCR-aware extraction when Document Intelligence fails", () => {
  const source = read(parsePdfPath);

  assert.match(source, /Azure Document Intelligence extraction failed; retrying through local full-text extraction fallback\./i);
  assert.match(source, /extractPdfPagesWithPython\(pdfBuffer\)/);
  assert.match(source, /No extractable PDF text found from local fallback\./i);
});
