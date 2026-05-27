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

function loadScorePreferenceFunctions() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "getLevelVisualScore"),
    extractFunctionSource(scriptSource, "toFiniteScoreOrNull"),
    extractFunctionSource(scriptSource, "hasInformativeScoreMap"),
    extractFunctionSource(scriptSource, "scoreMapHasVariance"),
    extractFunctionSource(scriptSource, "shouldPreferQualitativeScoreMap"),
    "globalThis.__exports = { shouldPreferQualitativeScoreMap, scoreMapHasVariance };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("qualitative score map is preferred when existing values collapse to uniformly low values", () => {
  const { shouldPreferQualitativeScoreMap } = loadScorePreferenceFunctions();
  const shouldPrefer = shouldPreferQualitativeScoreMap(
    { body: 25, heart: 25, head: 25 },
    { body: 80, heart: 55, head: 25 },
    { minPositive: 2 },
  );
  assert.equal(shouldPrefer, true);
});

test("qualitative score map is not preferred when existing values already have healthy variance", () => {
  const { shouldPreferQualitativeScoreMap } = loadScorePreferenceFunctions();
  const shouldPrefer = shouldPreferQualitativeScoreMap(
    { body: 80, heart: 55, head: 25 },
    { body: 80, heart: 55, head: 25 },
    { minPositive: 2 },
  );
  assert.equal(shouldPrefer, false);
});
