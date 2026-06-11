import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("dashboard script defines flexible phrase helper used by team stage and instinct extraction", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+buildFlexiblePhrasePattern\s*\(/,
    "Expected buildFlexiblePhrasePattern helper to be defined in report.js.",
  );
});

test("dashboard script includes targeted-section extraction helpers for missing-box hydration", () => {
  const script = read(reportJsPath);

  [
    "extractCoreIdentityFromTargetedSections",
    "extractSpreadsheetSectionFocusesFromTargetedSections",
    "extractTeamStageBreakdownFromTargetedSections",
    "extractFeedbackGuideFromTargetedSections",
    "extractDevelopmentExercisesFromTargetedSections",
  ].forEach((fnName) => {
    assert.match(
      script,
      new RegExp(`function\\s+${fnName}\\s*\\(`),
      `Expected targeted-section extraction helper: ${fnName}.`,
    );
  });
});

test("assigned-report ingestion flow merges targeted sections before fallback PDF parsing", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /const\s+targetedCoreIdentity\s*=\s*extractCoreIdentityFromTargetedSections\(\s*parsedProfile\s*\)/,
    "Expected ingest flow to derive core identity candidates from targeted sections.",
  );
  assert.match(
    script,
    /source:\s*"targeted_sections",\s*value:\s*targetedCoreIdentity\?\.coreFear/,
    "Expected coreFear hydration to include a targeted-sections candidate.",
  );
  assert.match(
    script,
    /source:\s*"targeted_sections",\s*value:\s*targetedCoreIdentity\?\.basicDesire/,
    "Expected gifts/core-desire hydration to include a targeted-sections candidate.",
  );
  assert.match(
    script,
    /source:\s*"targeted_sections",\s*value:\s*targetedCoreIdentity\?\.passion/,
    "Expected vice/passion hydration to include a targeted-sections candidate.",
  );
  assert.match(
    script,
    /source:\s*"targeted_sections",\s*value:\s*targetedCoreIdentity\?\.selfTalk/,
    "Expected self-talk hydration to include a targeted-sections candidate.",
  );
  assert.match(
    script,
    /source:\s*"targeted_sections",\s*value:\s*targetedCoreIdentity\?\.worldview/,
    "Expected worldview hydration to include a targeted-sections candidate.",
  );
  assert.match(
    script,
    /source:\s*"targeted_sections",\s*value:\s*targetedCoreIdentity\?\.focus/,
    "Expected focus hydration to include a targeted-sections candidate.",
  );
  assert.match(
    script,
    /extractFeedbackGuideFromTargetedSections\(\s*parsedProfile\s*\)/,
    "Expected feedback guide targeted extraction in ingest flow.",
  );
  assert.match(
    script,
    /extractDevelopmentExercisesFromTargetedSections\(\s*parsedProfile\s*\)/,
    "Expected development exercises targeted extraction in ingest flow.",
  );
  assert.match(
    script,
    /extractSpreadsheetSectionFocusesFromTargetedSections\(\s*parsedProfile\s*\)/,
    "Expected spreadsheet focus targeted extraction in ingest flow.",
  );
  assert.match(
    script,
    /extractTeamStageBreakdownFromTargetedSections\(\s*parsedProfile\s*\)/,
    "Expected team-stage targeted extraction in ingest flow.",
  );
});

test("strain score normalization includes targeted strain interpretation levels when available", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /parsedProfile\?\.targetedSections\?\.strain_interpretation/,
    "Expected targeted strain interpretation to be included as a strain score candidate source.",
  );
});
