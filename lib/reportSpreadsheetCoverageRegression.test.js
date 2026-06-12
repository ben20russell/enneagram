import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportHtmlPath = path.join(repoRoot, "public", "report.html");
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("dashboard exposes dynamic containers for remaining spreadsheet section focuses", () => {
  const html = read(reportHtmlPath);

  const requiredIds = [
    "motivationSummary",
    "instinctGoalSelfPres",
    "instinctGoalSocial",
    "instinctGoalOneOnOne",
    "communicationBodyLanguageList",
    "conflictResponseCopy",
    "conflictTriggeredCopy",
    "centeredDecisionCopy",
    "decisionImpactCopy",
    "decisionStrainCopy",
    "strategicLeadershipCopy",
    "teamImpactCopy",
    "interdependenceCopy",
  ];

  requiredIds.forEach((id) => {
    assert.match(
      html,
      new RegExp(`id="${id}"`),
      `Expected report.html to expose dynamic container: ${id}`,
    );
  });
});

test("dashboard script includes spreadsheet-focused extraction and merge helpers", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+extractSpreadsheetSectionFocusesFromReportContent\s*\(/,
    "Expected structured extraction helper for spreadsheet section focuses.",
  );

  assert.match(
    script,
    /function\s+extractSpreadsheetSectionFocusesFromPdfText\s*\(/,
    "Expected PDF-text extraction helper for spreadsheet section focuses.",
  );

  assert.match(
    script,
    /function\s+mergeSpreadsheetSectionFocuses\s*\(/,
    "Expected merge helper that combines structured and PDF-text focus snippets.",
  );
});

test("report render flow hydrates spreadsheet focus containers from active report context", () => {
  const script = read(reportJsPath);

  const hydrationCalls = [
    "motivationSummary",
    "instinctGoalSelfPres",
    "instinctGoalSocial",
    "instinctGoalOneOnOne",
    "conflictResponseCopy",
    "conflictTriggeredCopy",
    "centeredDecisionCopy",
    "decisionImpactCopy",
    "decisionStrainCopy",
    "strategicLeadershipCopy",
    "teamImpactCopy",
    "interdependenceCopy",
  ];

  hydrationCalls.forEach((id) => {
    assert.match(
      script,
      new RegExp(`set(?:Text|Html)\\(\\s*'${id}'\\s*,`),
      `Expected render flow to hydrate ${id}.`,
    );
  });

  assert.match(
    script,
    /setHtml\(\s*'communicationBodyLanguageList'\s*,/,
    "Expected render flow to hydrate body language list from active report context.",
  );
});
