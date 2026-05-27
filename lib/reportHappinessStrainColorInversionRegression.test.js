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
  const openBrace = source.indexOf("{", start);
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

function loadStrainColorFunctionsFromReportScript() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "isHappinessStrainCategory"),
    extractFunctionSource(scriptSource, "getStrainChipClass"),
    extractFunctionSource(scriptSource, "getStrainCardVisual"),
    "globalThis.__exports = { getStrainChipClass, getStrainCardVisual };",
  ];

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("Happiness strain chip levels use inverted color classes", () => {
  const { getStrainChipClass } = loadStrainColorFunctionsFromReportScript();
  assert.equal(getStrainChipClass("Low", "Happiness"), "strain-chip-high");
  assert.equal(getStrainChipClass("Medium", "Happiness"), "strain-chip-medium");
  assert.equal(getStrainChipClass("High", "Happiness"), "strain-chip-low");
});

test("Non-happiness strain chip levels keep standard color classes", () => {
  const { getStrainChipClass } = loadStrainColorFunctionsFromReportScript();
  assert.equal(getStrainChipClass("Low", "Physical"), "strain-chip-low");
  assert.equal(getStrainChipClass("Medium", "Physical"), "strain-chip-medium");
  assert.equal(getStrainChipClass("High", "Physical"), "strain-chip-high");
});

test("Happiness strain write-up card chips use inverted colors", () => {
  const { getStrainCardVisual } = loadStrainColorFunctionsFromReportScript();
  assert.equal(getStrainCardVisual("Low", "Happiness").chipClass, "cr");
  assert.equal(getStrainCardVisual("Medium", "Happiness").chipClass, "cg");
  assert.equal(getStrainCardVisual("High", "Happiness").chipClass, "cgn");
});

test("Non-happiness write-up card chips keep standard colors", () => {
  const { getStrainCardVisual } = loadStrainColorFunctionsFromReportScript();
  assert.equal(getStrainCardVisual("Low", "Vocational").chipClass, "cgn");
  assert.equal(getStrainCardVisual("Medium", "Vocational").chipClass, "cg");
  assert.equal(getStrainCardVisual("High", "Vocational").chipClass, "cr");
});
