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

test("extract_report_pdf builds a stable docling markdown JSON payload", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

payload = module.build_success_payload("# Summary\\n\\nMain Type 8")
print(json.dumps(payload))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.equal(parsed?.source, "docling_markdown");
  assert.equal(parsed?.markdown, "# Summary\n\nMain Type 8");
});

test("extract_report_pdf error payload keeps markdown key for Node parser safety", () => {
  const output = runPythonSnippet(`
import importlib.util
import json
import os

script_path = os.environ["SCRIPT_PATH"]
spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

payload = module.build_error_payload("docling unavailable")
print(json.dumps(payload))
  `);

  const parsed = JSON.parse(String(output || "{}"));
  assert.equal(parsed?.source, "docling_markdown");
  assert.equal(parsed?.markdown, "");
  assert.match(String(parsed?.error || ""), /docling unavailable/i);
});
