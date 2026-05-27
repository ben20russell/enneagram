import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function in dashboard script: ${functionName}`);
  }
  const signatureEnd = source.indexOf(")", start);
  const openBrace = source.indexOf("{", signatureEnd);
  if (openBrace === -1) {
    throw new Error(`Could not parse function in dashboard script: ${functionName}`);
  }
  let depth = 0;
  for (let idx = openBrace; idx < source.length; idx += 1) {
    const char = source[idx];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, idx + 1);
      }
    }
  }
  throw new Error(`Unbalanced braces while parsing function: ${functionName}`);
}

function loadFeedbackGridFunctionsFromReportScript() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "extractIndexedGuidanceRows"),
    "globalThis.__exports = { extractIndexedGuidanceRows };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("feedback guide parser extracts rows from icon grid text that uses plain numbers 1-9", () => {
  const { extractIndexedGuidanceRows } = loadFeedbackGridFunctionsFromReportScript();
  const feedbackText = `
    Feedback Guide
    1 Start the feedback on a sincere, positive note and acknowledge commitment to high standards.
    2 Show appreciation for contribution before discussing what needs adjustment.
    3 Keep it concise, outcome-focused, and linked to measurable goals.
    4 Validate emotional impact and then offer practical next steps.
    5 Give context and rationale so the request makes logical sense.
    6 Clarify expectations and timelines to reduce ambiguity and doubt.
    7 Keep the tone upbeat while being direct about consequences.
    8 Be direct, respectful, and concrete about behavior and impact.
    9 Invite them to state their view first, then agree clear actions.
  `;

  const rows = extractIndexedGuidanceRows(feedbackText, { fallbackText: "Not detected in assigned PDF." });
  assert.equal(rows.length, 9);
  assert.match(String(rows[0]?.guidance || ""), /sincere,\s*positive note/i);
  assert.match(String(rows[8]?.guidance || ""), /state their view first/i);
  assert.equal(
    rows.some((row) => /not detected/i.test(String(row?.guidance || ""))),
    false,
  );
});
