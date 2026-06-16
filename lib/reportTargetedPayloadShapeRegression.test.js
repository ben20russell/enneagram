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

function loadGetTargetedSections() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "getTargetedSections"),
    "globalThis.__exports = { getTargetedSections };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports.getTargetedSections;
}

test("getTargetedSections returns nested targetedSections payload when present", () => {
  const getTargetedSections = loadGetTargetedSections();
  const targeted = {
    strain_interpretation: { overall: "Overall strain remains moderate." },
    decision_framework: { making_decisions: ["Move quickly with clear checkpoints."] },
  };

  const resolved = getTargetedSections({ targetedSections: targeted });
  assert.equal(resolved, targeted);
});

test("getTargetedSections supports top-level targeted extraction payload shape", () => {
  const getTargetedSections = loadGetTargetedSections();
  const parsedProfile = {
    strain_interpretation: { overall: "Overall strain remains moderate." },
    feedback_guide: { type_8: "Be direct and specific." },
    decision_framework: { making_decisions: ["Move quickly with clear checkpoints."] },
    team_dynamics: { forming: "Clarify roles up front." },
    development_exercises: { strain: ["Add recovery blocks to your week."] },
  };

  const resolved = getTargetedSections(parsedProfile);

  assert.equal(
    String(resolved?.decision_framework?.making_decisions?.[0] || ""),
    "Move quickly with clear checkpoints.",
  );
  assert.equal(
    String(resolved?.team_dynamics?.forming || ""),
    "Clarify roles up front.",
  );
  assert.equal(
    String(resolved?.strain_interpretation?.overall || ""),
    "Overall strain remains moderate.",
  );
});
