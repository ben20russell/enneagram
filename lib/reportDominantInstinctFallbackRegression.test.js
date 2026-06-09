import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function in report script: ${functionName}`);
  }
  const signatureEnd = source.indexOf(")", start);
  const openBrace = source.indexOf("{", signatureEnd);
  if (openBrace === -1) {
    throw new Error(`Could not parse function in report script: ${functionName}`);
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

function loadExtractInstinctFromPdfText() {
  const repoRoot = path.resolve(process.cwd());
  const reportScriptPath = path.join(repoRoot, "public", "report.js");
  const source = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(source, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(source, "normalizeExtractedText"),
    extractFunctionSource(source, "instinctCodeToLabel"),
    extractFunctionSource(source, "extractInstinctFromPdfText"),
    "globalThis.__exports = { extractInstinctFromPdfText };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports.extractInstinctFromPdfText;
}

test("report fallback extracts instinct from Dominant Instinct label", () => {
  const extractInstinctFromPdfText = loadExtractInstinctFromPdfText();
  const instinct = extractInstinctFromPdfText("Dominant Instinct: SX");
  assert.equal(instinct, "SX — One-on-One");
});

test("report fallback extracts instinct from with-a Instinct sentence", () => {
  const extractInstinctFromPdfText = loadExtractInstinctFromPdfText();
  const instinct = extractInstinctFromPdfText("Ben, you are an Enneagram type 8 with a SO Instinct");
  assert.equal(instinct, "SO — Social");
});

