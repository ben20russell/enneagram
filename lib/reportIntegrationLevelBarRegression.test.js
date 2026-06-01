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

function loadIntegrationLevelFunctionsFromReportScript() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractConstSource(scriptSource, "INTEGRATION_LEVELS"),
    extractFunctionSource(scriptSource, "normalizeIntegrationLevel"),
    extractFunctionSource(scriptSource, "getIntegrationLevelIndex"),
    "globalThis.__exports = { INTEGRATION_LEVELS, normalizeIntegrationLevel, getIntegrationLevelIndex };",
  ];

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("integration level mapping normalizes common labels and aligns low to second segment", () => {
  const { INTEGRATION_LEVELS, normalizeIntegrationLevel, getIntegrationLevelIndex } =
    loadIntegrationLevelFunctionsFromReportScript();

  assert.equal(JSON.stringify(INTEGRATION_LEVELS), JSON.stringify([
    "Very Low",
    "Low",
    "Moderate",
    "High",
    "Very High",
  ]));

  assert.equal(normalizeIntegrationLevel("low"), "Low");
  assert.equal(normalizeIntegrationLevel("  MEDIUM "), "Moderate");
  assert.equal(normalizeIntegrationLevel("very high"), "Very High");
  assert.equal(getIntegrationLevelIndex("Very Low"), 0);
  assert.equal(getIntegrationLevelIndex("Low"), 1);
  assert.equal(getIntegrationLevelIndex("Moderate"), 2);
});

test("report render flow applies integration panel rendering from report integration value", () => {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const script = readFileSync(reportScriptPath, "utf8");
  assert.match(
    script,
    /const\s+normalizedIntegrationLevel\s*=\s*normalizeIntegrationLevel\(REPORT\.integration\);[\s\S]{0,180}renderIntegrationPanel\(\s*normalizedIntegrationLevel\s*\);/,
    "Expected report rendering to sync integration panel bars and labels from REPORT.integration.",
  );
  assert.match(
    script,
    /renderWingInfluencePanel\(\s*REPORT\s*,\s*normalizedIntegrationLevel\s*\)/,
    "Expected report rendering to update wing influence content when the active report changes.",
  );
  assert.match(script, /function\s+renderWingInfluencePanel\s*\(/);
  assert.match(script, /wingInfluenceHeading/);
  assert.match(script, /wingInfluenceGrid/);
});
