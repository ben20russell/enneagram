import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

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

function loadQualitativeScoreFunctionsFromReportScript() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractConstSource(scriptSource, "STRAIN_BREAKDOWN_ORDER"),
    extractConstSource(scriptSource, "STRAIN_LEVEL_SORT_RANK"),
    extractFunctionSource(scriptSource, "getStrainLevelSortRank"),
    extractFunctionSource(scriptSource, "getLevelVisualScore"),
    extractFunctionSource(scriptSource, "toFiniteScoreOrNull"),
    extractFunctionSource(scriptSource, "normalizeScoreScale"),
    extractFunctionSource(scriptSource, "scoreBandLabel"),
    extractFunctionSource(scriptSource, "getStrainValueByKey"),
    extractFunctionSource(scriptSource, "buildSortedStrainWriteupRows"),
    "globalThis.__exports = { normalizeScoreScale, getStrainValueByKey, buildSortedStrainWriteupRows };",
  ];

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("normalizeScoreScale maps HIGH/MEDIUM/LOW string levels to numeric scores", () => {
  const { normalizeScoreScale } = loadQualitativeScoreFunctionsFromReportScript();

  const normalized = normalizeScoreScale({
    body: "HIGH",
    heart: "medium",
    head: "Low",
    overall: "Moderate",
  });

  assert.equal(normalized.body, 80);
  assert.equal(normalized.heart, 55);
  assert.equal(normalized.head, 25);
  assert.equal(normalized.overall, 55);
});

test("strain values keep null as null instead of coercing to zero", () => {
  const { getStrainValueByKey } = loadQualitativeScoreFunctionsFromReportScript();
  const value = getStrainValueByKey({ happiness: null }, [null, null, null, null, null, null], "happiness");
  assert.equal(value, null);
});

test("overall strain write-up uses N/A when overall score is missing", () => {
  const { buildSortedStrainWriteupRows } = loadQualitativeScoreFunctionsFromReportScript();
  const rows = buildSortedStrainWriteupRows({}, [null, null, null, null, null, null], null);
  assert.equal(rows[0]?.title, "Overall Strain");
  assert.equal(rows[0]?.level, "N/A");
});
