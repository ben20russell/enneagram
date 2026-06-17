import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readReportScript() {
  return readFileSync(path.join(process.cwd(), "public", "report.js"), "utf8");
}

test("spreadsheet focus merge normalizes legacy payload shapes before fallback merge", () => {
  const script = readReportScript();
  assert.match(
    script,
    /function\s+normalizeSpreadsheetFocusSourcePayload\s*\(/,
    "Expected report script to define a helper that normalizes legacy spreadsheet focus payload shapes.",
  );
  assert.match(
    script,
    /const\s+normalizeSourcePayload\s*=\s*[\s\S]*normalizeSpreadsheetFocusSourcePayload[\s\S]*\(\s*value\s*\)\s*=>\s*\(\s*value\s*&&\s*typeof\s+value\s*===\s*"object"\s*\?\s*value\s*:\s*\{\}\s*\)/,
    "Expected spreadsheet focus merge to safely resolve legacy-normalization helper even in isolated test contexts.",
  );
  assert.match(
    script,
    /const\s+structured\s*=\s*normalizeSourcePayload\(\s*structuredFocuses\s*\)/,
    "Expected spreadsheet focus merge to normalize structured/deterministic payload input.",
  );
  assert.match(
    script,
    /const\s+pdf\s*=\s*normalizeSourcePayload\(\s*pdfFocuses\s*\)/,
    "Expected spreadsheet focus merge to normalize parsed-profile payload input.",
  );
});

test("legacy spreadsheet focus keys are mapped into dashboard hydration slots", () => {
  const script = readReportScript();
  assert.match(
    script,
    /communicationDynamics[\s\S]*bodyLanguageRows|bodyLanguageRows[\s\S]*communicationDynamics/,
    "Expected legacy communication dynamics payload to map into body-language hydration rows.",
  );
  assert.match(
    script,
    /decisionMaking[\s\S]*decisionImpactCopy|decisionImpactCopy[\s\S]*decisionMaking/,
    "Expected legacy decision-making payload to map into decision impact dashboard copy.",
  );
  assert.match(
    script,
    /conflictAndTriggers[\s\S]*conflictTriggeredCopy|conflictTriggeredCopy[\s\S]*conflictAndTriggers/,
    "Expected legacy conflict payload to map into conflict-triggered dashboard copy.",
  );
});
