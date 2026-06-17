import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(process.cwd());
const extractReportScriptPath = path.join(repoRoot, "scripts", "extract_report_pdf.py");

test("extract_report_pdf prints usage and returns non-zero when path arg is missing", () => {
  let error = null;
  try {
    execFileSync("python3", [extractReportScriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error, "Expected script to fail when PDF path argument is missing.");
  assert.match(String(error?.stdout || ""), /Usage:\s*python3 scripts\/extract_report_pdf\.py/i);
});

test("extract_report_pdf prints JSON error payload when PDF path is invalid", () => {
  const output = execFileSync(
    "python3",
    [extractReportScriptPath, "/tmp/this-file-does-not-exist-report.pdf"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  const parsed = JSON.parse(String(output || "{}"));
  assert.equal(parsed?.source, "docling_markdown");
  assert.equal(parsed?.markdown, "");
  assert.match(String(parsed?.error || ""), /file not found/i);
});
