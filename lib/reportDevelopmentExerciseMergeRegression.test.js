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
    extractFunctionSource(scriptSource, "ensureSentenceStartsCapitalized"),
    extractFunctionSource(scriptSource, "shouldMergeDevelopmentExerciseFragment"),
    extractFunctionSource(scriptSource, "normalizeDevelopmentExerciseRows"),
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

test("mergeDevelopmentExercises coalesces split fragments from the same thought into one exercise", () => {
  const { mergeDevelopmentExercises } = loadDevelopmentExerciseFunctions();
  const merged = mergeDevelopmentExercises(
    [
      { title: "Exercise 1", text: "the tendency to objectify people makes it easy" },
      {
        title: "Exercise 1",
        text:
          "your tendency towards leading an expansive and intense life can lead to you running yourself down without realising it.",
      },
    ],
    [],
  );

  assert.equal(merged.length, 1);
  assert.equal(String(merged[0]?.title || ""), "Exercise 1");
  assert.match(String(merged[0]?.text || ""), /^The tendency to objectify people makes it easy/i);
  assert.match(String(merged[0]?.text || ""), /\sYour tendency towards leading an expansive and intense life/i);
});

test("mergeDevelopmentExercises capitalizes sentence starts for legibility", () => {
  const { mergeDevelopmentExercises } = loadDevelopmentExerciseFunctions();
  const merged = mergeDevelopmentExercises(
    [
      { title: "Exercise 3", text: "practice one slower breath before responding in conflict." },
    ],
    [],
  );

  assert.equal(merged.length, 1);
  assert.equal(String(merged[0]?.title || ""), "Exercise 1");
  assert.match(String(merged[0]?.text || ""), /^Practice one slower breath before responding in conflict\./);
});
