import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readParsePdfSource() {
  return readFileSync(path.join(process.cwd(), "lib", "parsePdf.js"), "utf8");
}

test("attached parser maps normalized spreadsheet focus fields for dashboard hydration", () => {
  const source = readParsePdfSource();
  assert.match(
    source,
    /spreadsheetFocuses:\s*\{[\s\S]*motivationSummary[\s\S]*instinctGoals[\s\S]*centeredDecisionCopy[\s\S]*decisionImpactCopy[\s\S]*decisionStrainCopy[\s\S]*strategicLeadershipCopy[\s\S]*teamImpactCopy[\s\S]*interdependenceCopy[\s\S]*coachingRelationshipCopy[\s\S]*\}/,
    "Expected attached parse mapping to populate normalized spreadsheet focus keys used by dashboard hydration.",
  );
});

test("attached parser preserves legacy spreadsheet focus keys for backward compatibility", () => {
  const source = readParsePdfSource();
  assert.match(
    source,
    /spreadsheetFocuses:\s*\{[\s\S]*communicationDynamics:\s*serializeObject\(communication\)[\s\S]*decisionMaking:\s*serializeObject\(decision\)[\s\S]*leadershipAndManagement:\s*serializeObject\(leadership\)[\s\S]*conflictAndTriggers:\s*serializeObject\(conflict\)[\s\S]*teamBehaviour:\s*serializeObject\(team\)[\s\S]*\}/,
    "Expected attached parse mapping to keep legacy serialized spreadsheet focus keys for older hydration logic.",
  );
});
