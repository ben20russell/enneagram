import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("structured decision strain extraction uses the dedicated source resolver", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /decisionStrainCopy:\s*decisionStrainInstructionText/,
    "Expected the full decision-specific source rather than a generic label snippet.",
  );
  assert.match(
    script,
    /const decisionStrainInstructionText = resolveDecisionStrainCopy\(parsedProfile\)/,
    "Expected resolution from the decision section, not the page 18 overall-strain rule.",
  );
});

test("fallback PDF extraction preserves the whole decision strain section", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /decisionStrainCopy:\s*extractDecisionStrainCopyFromText\(pdfText\)/,
    "Expected a section-bounded extractor without a first-period or character cutoff.",
  );
});

test("narrative cleanup cannot replace complete decision strain source copy", () => {
  const script = read(reportJsPath);
  assert.match(
    script,
    /decisionStrainCopy: decisionStrainCopyFromSource \|\| "Not detected in assigned PDF\."/,
    "Expected the source copy to survive narrative cleanup, including stale cached cleanup.",
  );
  assert.match(script, /renderDecisionStrainCopy\(spreadsheetFocusesFromReport\.decisionStrainCopy\)/);
});
