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

function loadDevelopmentExerciseFunctions() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "isMissingExtractedText"),
    extractFunctionSource(scriptSource, "isLikelyGarbledDevelopmentExerciseText"),
    extractFunctionSource(scriptSource, "splitDevelopmentExercisesTextBlock"),
    extractFunctionSource(scriptSource, "mergeDevelopmentExercises"),
    "globalThis.__exports = { mergeDevelopmentExercises };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("mergeDevelopmentExercises splits multi-exercise text blocks into multiple clean rows", () => {
  const { mergeDevelopmentExercises } = loadDevelopmentExerciseFunctions();
  const merged = mergeDevelopmentExercises(
    [
      {
        title: "Exercise 1",
        text:
          "DEVELOPMENT EXERCISE: Slow your breathing and relax your jaw. DEVELOPMENT EXERCISE: Ask one clarifying question before responding.",
      },
    ],
    [],
  );

  assert.equal(merged.length, 2);
  assert.match(String(merged[0]?.text || ""), /slow your breathing/i);
  assert.match(String(merged[1]?.text || ""), /clarifying question/i);
});

test("mergeDevelopmentExercises rejects garbled footer rows and falls back to clean alternatives", () => {
  const { mergeDevelopmentExercises } = loadDevelopmentExerciseFunctions();
  const merged = mergeDevelopmentExercises(
    [
      {
        title: "Exercise 1",
        text: "Copyright 2010-2022 Integrative Enneagram Solutions Ben Russell 7 of 42",
      },
    ],
    [
      {
        title: "Exercise 1",
        text: "Name one body signal before reacting.",
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.match(String(merged[0]?.text || ""), /body signal before reacting/i);
});
