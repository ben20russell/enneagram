import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(process.cwd());
const extractPagesScriptPath = path.join(repoRoot, "lib", "extract_pdf_pages.py");

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
        SCRIPT_PATH: extractPagesScriptPath,
        ...env,
      },
    },
  );
}

test("extract_pdf_pages defines OCR noise heuristics and dependency checks", () => {
  const source = read(extractPagesScriptPath);

  assert.match(source, /def\s+is_text_noisy\s*\(/);
  assert.match(source, /CID_TOKEN_PATTERN|cid:\s*\\d\+/i);
  assert.match(source, /REPLACEMENT_CHAR_PATTERN|\\uFFFD/);
  assert.match(source, /def\s+ensure_ocr_dependencies\s*\(/);
  assert.match(source, /pdftoppm|pdftocairo|poppler/i);
  assert.match(source, /tesseract|pytesseract\.image_to_string/i);
});

test("extract_pdf_pages is_text_noisy flags cid-heavy text and allows healthy text", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_pdf_pages", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

noisy = "(cid:101) (cid:202) (cid:303) \\uFFFD \\uFFFD \\uFFFD \\uFFFD"
healthy = "Main Type 8. Dominant Instinct: SX. Report Date: 06/08/2026."
print(json.dumps({
  "noisy": module.is_text_noisy(noisy),
  "healthy": module.is_text_noisy(healthy),
}))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.equal(parsed?.noisy, true);
  assert.equal(parsed?.healthy, false);
});

test("extract_pdf_pages hard-fails when noisy text needs OCR but dependencies are unavailable", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os
from pathlib import Path

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_pdf_pages", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

module.extract_primary_pages = lambda _pdf_path: (["(cid:101) " * 64], "mock_primary")
module.ensure_ocr_dependencies = lambda: {
  "available": False,
  "missing": ["poppler", "tesseract"],
  "pdftoppm_path": None,
  "pdftocairo_path": None,
  "tesseract_path": None,
}

error_message = ""
try:
  module.extract_pages_with_ocr_fallback(Path("mock.pdf"))
except Exception as error:
  error_message = str(error)

print(json.dumps({
  "error": error_message,
  "mentionsOcrDeps": bool(error_message and ("poppler" in error_message.lower() or "tesseract" in error_message.lower())),
}))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.equal(Boolean(parsed?.error), true);
  assert.equal(parsed?.mentionsOcrDeps, true);
});
