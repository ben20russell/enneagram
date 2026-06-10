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
  const paramStart = source.indexOf("(", start);
  if (paramStart === -1) {
    throw new Error(`Could not parse function parameters in dashboard script: ${functionName}`);
  }
  let paramDepth = 0;
  let paramEnd = -1;
  for (let idx = paramStart; idx < source.length; idx += 1) {
    const char = source[idx];
    if (char === "(") paramDepth += 1;
    if (char === ")") {
      paramDepth -= 1;
      if (paramDepth === 0) {
        paramEnd = idx;
        break;
      }
    }
  }
  if (paramEnd === -1) {
    throw new Error(`Could not find function parameter end in dashboard script: ${functionName}`);
  }
  const openBrace = source.indexOf("{", paramEnd);
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

function extractConstSource(source, constName) {
  const startToken = `const ${constName} =`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing constant in dashboard script: ${constName}`);
  }
  const end = source.indexOf(";\n", start);
  if (end === -1) {
    throw new Error(`Could not parse constant in dashboard script: ${constName}`);
  }
  return source.slice(start, end + 2);
}

function loadCenterExtractionFunctions() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "escapeRegex"),
    extractFunctionSource(scriptSource, "getLevelVisualScore"),
    extractFunctionSource(scriptSource, "toFiniteScoreOrNull"),
    extractFunctionSource(scriptSource, "hasInformativeScoreMap"),
    extractConstSource(scriptSource, "FLEXIBLE_LEVEL_TOKEN_PATTERN"),
    extractFunctionSource(scriptSource, "normalizeFlexibleLevelToken"),
    extractFunctionSource(scriptSource, "buildFlexibleWordPattern"),
    extractFunctionSource(scriptSource, "buildFlexibleLabelPattern"),
    extractFunctionSource(scriptSource, "extractLevelForLabel"),
    extractFunctionSource(scriptSource, "extractLabelLevelPairs"),
    extractFunctionSource(scriptSource, "buildCenterScoresFromQualitativeText"),
    "globalThis.__exports = { buildCenterScoresFromQualitativeText };",
  ];

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("buildCenterScoresFromQualitativeText parses letter-spaced Action Center labels", () => {
  const { buildCenterScoresFromQualitativeText } = loadCenterExtractionFunctions();
  const text = [
    "A c t i o n Center o f Expression : M e d i u m",
    "Feeling Center of Expression: MEDIUM",
    "Thinking Center of Expression: LOW",
  ].join(" ");
  const scores = buildCenterScoresFromQualitativeText(text);

  assert.equal(scores?.body, 50);
  assert.equal(scores?.heart, 50);
  assert.equal(scores?.head, 0);
});
