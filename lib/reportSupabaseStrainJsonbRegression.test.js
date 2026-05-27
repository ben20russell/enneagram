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

function loadStrainParsingFunctions() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "getLevelVisualScore"),
    extractFunctionSource(scriptSource, "toFiniteScoreOrNull"),
    extractFunctionSource(scriptSource, "getParsedProfileStrainScores"),
    "globalThis.__exports = { getParsedProfileStrainScores };",
  ];

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("parsedProfile.strainScores from Supabase JSONB maps directly into dashboard strain scores", () => {
  const { getParsedProfileStrainScores } = loadStrainParsingFunctions();
  const mapped = getParsedProfileStrainScores({
    strainScores: {
      happiness: 78,
      vocational: 61,
      interpersonal: 44,
      physical: 52,
      environmental: 35,
      psychological: 66,
    },
  });

  assert.equal(mapped.happiness, 78);
  assert.equal(mapped.vocational, 61);
  assert.equal(mapped.interpersonal, 44);
  assert.equal(mapped.physical, 52);
  assert.equal(mapped.environmental, 35);
  assert.equal(mapped.psychological, 66);
  assert.equal(mapped.overall, 56);
});

test("parsedProfile strain levels in jsonb map LOW/MEDIUM/HIGH strings into numeric dashboard levels", () => {
  const { getParsedProfileStrainScores } = loadStrainParsingFunctions();
  const mapped = getParsedProfileStrainScores({
    strain_levels: {
      happiness_strain: "HIGH",
      vocational_strain: "MEDIUM",
      interpersonal_strain: "LOW",
      physical_strain: "HIGH",
      environmental_strain: "LOW",
      psychological_strain: "MEDIUM",
    },
  });

  assert.equal(mapped.happiness, 80);
  assert.equal(mapped.vocational, 55);
  assert.equal(mapped.interpersonal, 25);
  assert.equal(mapped.physical, 80);
  assert.equal(mapped.environmental, 25);
  assert.equal(mapped.psychological, 55);
  assert.equal(mapped.overall, 53);
});
