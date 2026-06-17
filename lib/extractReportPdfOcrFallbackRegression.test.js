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

test("extract_report_pdf uses pymupdf4llm layout extraction and emits HTML-table payload", () => {
  const source = read(extractReportScriptPath);

  assert.match(
    source,
    /pymupdf4llm/,
    "Expected extract_report_pdf.py to use pymupdf4llm for layout-aware extraction.",
  );
  assert.match(
    source,
    /ensure_html_tables/,
    "Expected extract_report_pdf.py to normalize markdown tables into strict HTML tables.",
  );
  assert.match(
    source,
    /SOURCE_LABEL\s*=\s*"layout_html_markdown"/,
    "Expected extract_report_pdf.py to identify payload source label as layout_html_markdown.",
  );
  assert.match(
    source,
    /"structured_document"\s*:/,
    "Expected extract_report_pdf.py payload to include structured_document content.",
  );
});

test("extract_report_pdf helper converts markdown tables into HTML tables using injected extractor", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os
from pathlib import Path

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fake_to_markdown(_pdf_path, **_kwargs):
  return "# iEQ9 Report\\n\\n| Summary | Value |\\n| --- | --- |\\n| Main Type | 8 |"

structured = module.extract_markdown_with_pymupdf4llm(Path("mock.pdf"), to_markdown_fn=fake_to_markdown)
print(json.dumps({"structured": structured}))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.match(String(parsed?.structured || ""), /# iEQ9 Report/);
  assert.match(String(parsed?.structured || ""), /<table>/i);
  assert.match(String(parsed?.structured || ""), /<td>Main Type<\/td>/i);
});
