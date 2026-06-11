import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("report script defines deterministic hydration source-priority resolver", () => {
  const source = read(reportScriptPath);

  assert.match(
    source,
    /const\s+HYDRATION_SOURCE_PRIORITY\s*=\s*Object\.freeze\(\s*\[/,
    "Expected deterministic hydration source priority list.",
  );

  assert.match(
    source,
    /"verification_python"[\s\S]*"targeted_sections"[\s\S]*"js_deterministic"[\s\S]*"parsed_profile_llm"[\s\S]*"dashboard_context_default"/,
    "Expected explicit hydration source priority ordering from verification/python through dashboard defaults.",
  );

  assert.match(
    source,
    /function\s+createHydrationAuditTracker\s*\(/,
    "Expected a single hydration resolver/audit tracker factory.",
  );
});

test("assigned/client ingestion merges deterministic section hydration before parsedProfile LLM fallback", () => {
  const source = read(reportScriptPath);

  assert.match(
    source,
    /const\s+jsFeedbackGuideRows\s*=\s*mergeFeedbackGuideRows\(/,
    "Expected explicit JS deterministic feedback-guide merge stage.",
  );

  assert.match(
    source,
    /const\s+feedbackGuideDeterministicRows\s*=\s*mergeFeedbackGuideRows\(\s*targetedFeedbackRows\s*,\s*jsFeedbackGuideRows\s*\)/,
    "Expected targeted feedback rows to take precedence over JS deterministic feedback rows.",
  );

  assert.match(
    source,
    /const\s+feedbackGuideMatrix\s*=\s*mergeFeedbackGuideRows\(\s*feedbackGuideDeterministicRows\s*,\s*parsedProfileFeedbackRows\s*\)/,
    "Expected parsedProfile feedback rows to be fallback after deterministic feedback hydration.",
  );

  assert.match(
    source,
    /const\s+strainDeterministicRows\s*=\s*mergeCategoryWriteups\(/,
    "Expected deterministic-first strain qualitative merge stage.",
  );

  assert.match(
    source,
    /const\s+developmentExercisesDeterministic\s*=\s*mergeDevelopmentExercises\(/,
    "Expected deterministic-first development exercise merge stage.",
  );

  assert.match(
    source,
    /const\s+spreadsheetFocusesDeterministic\s*=\s*mergeSpreadsheetSectionFocuses\(/,
    "Expected deterministic-first spreadsheet focus merge stage.",
  );

  assert.match(
    source,
    /const\s+teamStageDeterministicBreakdown\s*=\s*mergeTeamStageBreakdown\(/,
    "Expected deterministic-first team-stage merge stage.",
  );

  assert.match(
    source,
    /const\s+llmOverallStrainSummary\s*=\s*extractOverallStrainSummaryFromLlmProfile\(parsedProfile\)/,
    "Expected hydration flow to derive overall strain boundaries from parsed LLM output.",
  );

  assert.match(
    source,
    /source:\s*"parsed_profile_llm",\s*value:\s*llmOverallStrainSummary/,
    "Expected overall strain hydration to include parsed LLM summary as an explicit candidate source.",
  );
});

test("hydration diagnostics payload exposes slot contract coverage and source audit metadata", () => {
  const source = read(reportScriptPath);

  assert.match(
    source,
    /const\s+ASSIGNED_HYDRATION_REQUIRED_SLOTS\s*=\s*Object\.freeze\(\s*\[/,
    "Expected a required slot contract list for assigned/client hydration.",
  );

  assert.match(
    source,
    /function\s+applyAssignedHydrationContractDiagnostics\s*\(/,
    "Expected a render-time hydration contract validator.",
  );

  assert.match(
    source,
    /const\s+dataQualityDiagnostics\s*=\s*\{\s*[\s\S]*hydration:\s*\{\s*[\s\S]*requiredSlots[\s\S]*hydratedSlots[\s\S]*missingSlots[\s\S]*duplicateCandidates[\s\S]*deterministicHitCount[\s\S]*llmFallbackCount[\s\S]*\}/,
    "Expected hydration diagnostics to include contract coverage and source-resolution counters.",
  );

  assert.match(
    source,
    /hydrationSourceAudit\s*:/,
    "Expected hydration source-audit map to be included in assigned report payload/context.",
  );

  assert.match(
    source,
    /\[hydration-contract\]/,
    "Expected structured hydration contract logging for debugging.",
  );
});
