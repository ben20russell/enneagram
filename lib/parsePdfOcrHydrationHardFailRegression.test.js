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

test("parsePdf attached hydration rethrows unrecoverable OCR/noise failures instead of silently swallowing them", () => {
  const source = read(parsePdfPath);

  assert.match(source, /shouldHardFailHydration/);
  assert.match(source, /Local page hydration failed due to unrecoverable noisy text extraction/i);
  assert.match(source, /noisy\\s\+pdf\\s\+pages\|ocr\\s\+fallback\|ocr\\s\+recovery/i);
});
