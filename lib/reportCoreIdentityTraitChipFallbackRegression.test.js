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

function loadTraitChipResolver() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "formatOptionalText"),
    extractFunctionSource(scriptSource, "ensureSentenceStartsCapitalized"),
    extractFunctionSource(scriptSource, "resolveReportTraitChips"),
    "globalThis.__exports = { resolveReportTraitChips };",
  ];
  const context = {
    globalThis: {},
    REPORT_EXAMPLES: {
      "2": {
        traits: ["supportive", "relational", "warm", "encouraging", "loyal"],
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("resolveReportTraitChips uses parsed traits when present", () => {
  const { resolveReportTraitChips } = loadTraitChipResolver();

  const chips = resolveReportTraitChips({
    typeNumber: "2",
    traits: ["empathetic", "steady", "uplifting"],
  });

  assert.equal(Array.isArray(chips), true);
  assert.equal(chips.length, 3);
  assert.equal(chips[0], "Empathetic");
  assert.equal(chips[1], "Steady");
  assert.equal(chips[2], "Uplifting");
});

test("resolveReportTraitChips falls back to type defaults when parsed traits are missing", () => {
  const { resolveReportTraitChips } = loadTraitChipResolver();

  const chips = resolveReportTraitChips({
    typeNumber: "2",
    traits: [],
  });

  assert.equal(Array.isArray(chips), true);
  assert.equal(chips.length, 5);
  assert.equal(chips[0], "Supportive");
  assert.equal(chips[1], "Relational");
  assert.equal(chips[2], "Warm");
  assert.equal(chips[3], "Encouraging");
  assert.equal(chips[4], "Loyal");
});

test("resolveReportTraitChips returns generic fallback chips when type defaults are unavailable", () => {
  const { resolveReportTraitChips } = loadTraitChipResolver();

  const chips = resolveReportTraitChips({
    typeNumber: "?",
    traits: ["", "   "],
  });

  assert.equal(Array.isArray(chips), true);
  assert.equal(chips.length >= 3, true);
  assert.match(chips[0], /^[A-Z]/);
  assert.match(chips[1], /^[A-Z]/);
  assert.match(chips[2], /^[A-Z]/);
});
