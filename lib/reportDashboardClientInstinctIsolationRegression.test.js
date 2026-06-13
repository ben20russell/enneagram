import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readReportScript() {
  return readFileSync(path.join(process.cwd(), "public", "report.js"), "utf8");
}

test("dashboard narrative cleanup defines a strict instinct-goal isolation helper", () => {
  const script = readReportScript();
  assert.match(
    script,
    /function\s+resolveIsolatedInstinctGoalCleanupText\s*\(/,
    "Expected a dedicated helper that blocks cross-instinct spillover before dashboard merge resolution.",
  );
});

test("dashboard narrative cleanup spreadsheet normalization uses strict instinct-goal isolation helper", () => {
  const script = readReportScript();
  assert.match(
    script,
    /selfPres:\s*resolveIsolatedInstinctGoalCleanupText\(\s*instinctGoals\?\.selfPres\s*,\s*"selfPres"\s*\)\s*\|\|\s*"Not detected in assigned PDF\."/,
    "Expected SP instinct normalization to use strict isolation helper instead of raw fallback text.",
  );
  assert.match(
    script,
    /social:\s*resolveIsolatedInstinctGoalCleanupText\(\s*instinctGoals\?\.social\s*,\s*"social"\s*\)\s*\|\|\s*"Not detected in assigned PDF\."/,
    "Expected SO instinct normalization to use strict isolation helper instead of raw fallback text.",
  );
  assert.match(
    script,
    /oneOnOne:\s*resolveIsolatedInstinctGoalCleanupText\(\s*instinctGoals\?\.oneOnOne\s*,\s*"oneOnOne"\s*\)\s*\|\|\s*"Not detected in assigned PDF\."/,
    "Expected SX instinct normalization to use strict isolation helper instead of raw fallback text.",
  );
});

test("dashboard narrative merge does not reintroduce contaminated instinct fallback text", () => {
  const script = readReportScript();
  assert.match(
    script,
    /const\s+preferredText\s*=\s*resolveIsolatedInstinctGoalCleanupText\([\s\S]*?preferred\.spreadsheetFocuses\?\.instinctGoals\?\.\[key\][\s\S]*?key[\s\S]*?\)/,
    "Expected instinct-goal merge to normalize preferred text through strict isolation helper.",
  );
  assert.match(
    script,
    /const\s+fallbackText\s*=\s*resolveIsolatedInstinctGoalCleanupText\([\s\S]*?fallback\.spreadsheetFocuses\?\.instinctGoals\?\.\[key\][\s\S]*?key[\s\S]*?\)/,
    "Expected instinct-goal merge to normalize fallback text through strict isolation helper.",
  );
  assert.doesNotMatch(
    script,
    /const\s+preferredText\s*=\s*isolateInstinctGoalTopicText\([\s\S]*?\)\s*\|\|\s*normalizeDashboardNarrativeCleanupText\(/,
    "Expected instinct-goal merge to avoid raw normalize fallback that can reintroduce cross-instinct references.",
  );
});
