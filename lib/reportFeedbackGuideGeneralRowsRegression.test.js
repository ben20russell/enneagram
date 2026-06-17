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
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unbalanced braces while parsing function: ${functionName}`);
}

function loadFeedbackFns() {
  const script = readFileSync(path.join(process.cwd(), "public", "report.js"), "utf8");
  const pieces = [
    extractFunctionSource(script, "stripControlNoiseCharacters"),
    extractFunctionSource(script, "hasExcessiveSymbolNoise"),
    extractFunctionSource(script, "isCorruptedExtractedSnippet"),
    extractFunctionSource(script, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(script, "normalizeExtractedText"),
    extractFunctionSource(script, "sanitizeSnippet"),
    extractFunctionSource(script, "cleanPdfExtractedValue"),
    extractFunctionSource(script, "escapeRegex"),
    extractFunctionSource(script, "buildFlexibleWordPattern"),
    extractFunctionSource(script, "buildFlexiblePhrasePattern"),
    extractFunctionSource(script, "isMissingExtractedText"),
    extractFunctionSource(script, "extractGeneralFeedbackRowsFromText"),
    extractFunctionSource(script, "mergeFeedbackGuideRows"),
    "globalThis.__feedbackFns = { extractGeneralFeedbackRowsFromText, mergeFeedbackGuideRows };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__feedbackFns;
}

test("extractGeneralFeedbackRowsFromText parses giving/receiving arrays from serialized feedback blocks", () => {
  const { extractGeneralFeedbackRowsFromText } = loadFeedbackFns();
  const source = `{
    "giving": [
      "Be direct and specific about observable behaviour.",
      "Ask permission before giving informal feedback."
    ],
    "receiving": [
      "Avoid defensiveness and ask clarifying questions.",
      "Acknowledge impact before responding with intent."
    ]
  }`;

  const rows = extractGeneralFeedbackRowsFromText(source, {
    fallbackText: "Not detected in assigned PDF.",
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.type, "Giving Feedback");
  assert.match(String(rows[0]?.guidance || ""), /direct and specific/i);
  assert.equal(rows[1]?.type, "Receiving Feedback");
  assert.match(String(rows[1]?.guidance || ""), /avoid defensiveness/i);
});

test("mergeFeedbackGuideRows preserves general guidance rows when type-indexed rows are unavailable", () => {
  const { mergeFeedbackGuideRows } = loadFeedbackFns();
  const merged = mergeFeedbackGuideRows(
    [
      {
        type: "Giving Feedback",
        label: "",
        guidance: "Be direct, specific, and respectful.",
      },
      {
        type: "Receiving Feedback",
        label: "",
        guidance: "Listen fully and acknowledge impact before responding.",
      },
    ],
    [],
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.type, "Giving Feedback");
  assert.equal(merged[1]?.type, "Receiving Feedback");
  assert.doesNotMatch(JSON.stringify(merged), /Type 1/);
  assert.doesNotMatch(JSON.stringify(merged), /Not detected in assigned PDF/i);
});
