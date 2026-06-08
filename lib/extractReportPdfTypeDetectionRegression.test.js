import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(process.cwd());
const extractReportScriptPath = path.join(repoRoot, "scripts", "extract_report_pdf.py");

function runExtractType(text) {
  const output = execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util
import json
import os

script_path = os.environ["SCRIPT_PATH"]
input_text = os.environ.get("INPUT_TEXT", "")

spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

detected, source = module.extract_type(module.normalize(input_text))
print(json.dumps({"detected": detected, "source": source}))
      `.trim(),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SCRIPT_PATH: extractReportScriptPath,
        INPUT_TEXT: text,
      },
    },
  );

  return JSON.parse(String(output || "{}"));
}

test("extract_report_pdf detects main type from OCR letter-spaced MAIN TYPE # pattern", () => {
  const sampleText = [
    "M A I N   T Y P E   # 8",
    "with a S X instinct.",
    "A deeper understanding of the S X — 8",
  ].join(" ");

  const detected = runExtractType(sampleText);

  assert.equal(
    detected?.detected,
    "8",
    "Expected OCR letter-spaced MAIN TYPE header text to resolve detectedType=8.",
  );
});

test("extract_report_pdf detects main type from compact MAIN TYPE # pattern", () => {
  const sampleText = "Main Type # 6 with a SO instinct. You resonate with the Enneagram type 6.";
  const detected = runExtractType(sampleText);
  assert.equal(detected?.detected, "6");
});
