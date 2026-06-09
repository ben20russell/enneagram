import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(process.cwd());
const extractReportScriptPath = path.join(repoRoot, "scripts", "extract_report_pdf.py");

function runExtractInstinctFromPages(pages) {
  const output = execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util
import json
import os

script_path = os.environ["SCRIPT_PATH"]
pages = json.loads(os.environ.get("PAGES_JSON", "[]"))

spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

instinct, source = module.extract_instinct_from_pages(pages, preferred_page_number=10)
print(json.dumps({"instinct": instinct, "source": source}))
      `.trim(),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SCRIPT_PATH: extractReportScriptPath,
        PAGES_JSON: JSON.stringify(pages),
      },
    },
  );

  return JSON.parse(String(output || "{}"));
}

test("extract_report_pdf prioritizes page 10 dominant instinct label for instinct detection", () => {
  const pages = [
    "Intro page",
    "Main Type # 8 with a SP Instinct is shown in summary table.",
    "Context page",
    "Context page",
    "Context page",
    "Context page",
    "Context page",
    "Context page",
    "Context page",
    "Dominant Instinct: SX",
    "Appendix",
  ];

  const extracted = runExtractInstinctFromPages(pages);

  assert.equal(extracted?.instinct, "SX — One-on-One");
  assert.equal(extracted?.source, "page10:dominantInstinctLabel");
});

