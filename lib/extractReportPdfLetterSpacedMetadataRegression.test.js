import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(process.cwd());
const extractReportScriptPath = path.join(repoRoot, "scripts", "extract_report_pdf.py");

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

test("extract_report_pdf builds a stable layout_html_markdown JSON payload", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

payload = module.build_success_payload("# Summary\\n\\n<table><tr><td>Main Type</td><td>8</td></tr></table>")
print(json.dumps(payload))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.equal(parsed?.source, "layout_html_markdown");
  assert.equal(parsed?.structured_document, "# Summary\n\n<table><tr><td>Main Type</td><td>8</td></tr></table>");
  assert.equal(parsed?.markdown, "# Summary\n\n<table><tr><td>Main Type</td><td>8</td></tr></table>");
  assert.equal(parsed?.table_format, "html");
});

test("extract_report_pdf error payload keeps compatibility keys for Node parser safety", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

payload = module.build_error_payload("pymupdf4llm unavailable")
print(json.dumps(payload))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.equal(parsed?.source, "layout_html_markdown");
  assert.equal(parsed?.structured_document, "");
  assert.equal(parsed?.markdown, "");
  assert.equal(parsed?.table_format, "html");
  assert.match(String(parsed?.error || ""), /pymupdf4llm unavailable/i);
});
