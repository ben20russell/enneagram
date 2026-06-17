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

test("extract_report_pdf uses Docling DocumentConverter and exports markdown payload", () => {
  const source = read(extractReportScriptPath);

  assert.match(
    source,
    /docling\.document_converter\s+import\s+DocumentConverter|from\s+docling\.document_converter\s+import\s+DocumentConverter/,
    "Expected extract_report_pdf.py to use Docling DocumentConverter.",
  );
  assert.match(
    source,
    /export_to_markdown\s*\(/,
    "Expected extract_report_pdf.py to export Docling output as markdown.",
  );
  assert.match(
    source,
    /"source"\s*:\s*"docling_markdown"/,
    "Expected extract_report_pdf.py to identify payload source as docling_markdown.",
  );
  assert.match(
    source,
    /"markdown"\s*:/,
    "Expected extract_report_pdf.py payload to include markdown content.",
  );
});

test("extract_report_pdf helper returns markdown from injected converter without requiring docling runtime", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os
from pathlib import Path

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakeDocument:
  def export_to_markdown(self):
    return "# iEQ9 Report\\n\\n## Main Type\\n8"

class FakeResult:
  def __init__(self):
    self.document = FakeDocument()

class FakeConverter:
  def convert(self, _pdf_path):
    return FakeResult()

markdown = module.extract_markdown_with_docling(Path("mock.pdf"), converter=FakeConverter())
print(json.dumps({"markdown": markdown}))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.match(String(parsed?.markdown || ""), /# iEQ9 Report/);
  assert.match(String(parsed?.markdown || ""), /Main Type/);
});
