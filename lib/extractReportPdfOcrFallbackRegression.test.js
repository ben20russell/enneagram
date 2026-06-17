import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(process.cwd());
const extractReportScriptPath = path.join(repoRoot, "scripts", "extract_report_pdf.py");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function runPythonSnippet(code, env = {}) {
  return execFileSync(
    "python3",
    ["-c", code.trim()],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SCRIPT_PATH: extractReportScriptPath,
        ...env,
      },
    },
  );
}

test("extract_report_pdf defines heuristic noise detector and OCR fallback helpers", () => {
  const source = read(extractReportScriptPath);

  assert.match(source, /def\s+is_text_noisy\s*\(/);
  assert.match(source, /CID_TOKEN_PATTERN|cid:\s*\\d\+/i);
  assert.match(source, /\\uFFFD|REPLACEMENT_CHAR_PATTERN/);
  assert.match(source, /alphanumeric|alnum|printable/i);
  assert.match(source, /pytesseract\.image_to_string/);
  assert.match(source, /pdf2image|convert_from_path/);
});

test("is_text_noisy flags cid/replacement-heavy text and allows healthy text", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

noisy = "(cid:101) (cid:202) (cid:303) \\uFFFD \\uFFFD \\uFFFD \\uFFFD"
healthy = "Main Type 8. Dominant Instinct: SX. Report Date: 06/08/2026"
print(json.dumps({
  "noisy": module.is_text_noisy(noisy),
  "healthy": module.is_text_noisy(healthy),
}))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.equal(parsed?.noisy, true);
  assert.equal(parsed?.healthy, false);
});

test("OCR fallback pipeline is triggered when primary text is noisy", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os
from pathlib import Path

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

called = {"ocr": False}

def fake_primary(_pdf_path):
  return ["(cid:101) (cid:202) \\uFFFD \\uFFFD \\uFFFD"], "primary_mock"

def fake_ocr(_pdf_path, page_numbers, **_kwargs):
  called["ocr"] = True
  return {int(page_numbers[0]): "Main Type 8 Dominant Instinct SX"}

module.extract_text_primary_attempt = fake_primary
module.extract_text_with_tesseract_ocr = fake_ocr

pages, diagnostics = module.extract_page_texts_with_ocr_fallback(Path("mock.pdf"))
print(json.dumps({
  "ocrCalled": called["ocr"],
  "firstPage": pages[0] if pages else None,
  "fallbackTriggered": diagnostics.get("fallbackTriggered"),
}))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.equal(parsed?.ocrCalled, true);
  assert.equal(parsed?.fallbackTriggered, true);
  assert.match(String(parsed?.firstPage || ""), /Main Type 8/i);
});
