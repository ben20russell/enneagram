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

test("centers section exposes sortable center rows and narrative rows", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="centerExpressionRows"/,
    "Expected centers section to expose a dedicated row container for sorted center rows.",
  );

  assert.match(
    html,
    /data-center-row="body"[\s\S]*data-center-row="heart"[\s\S]*data-center-row="head"/,
    "Expected center rows to carry center-key attributes for deterministic re-ordering.",
  );

  assert.match(
    html,
    /id="centerExpressionNarratives"/,
    "Expected centers narrative list to expose a sortable container.",
  );
});

test("centers section exposes dynamic containers for dominant summary and pattern columns", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="centerDominanceSummary"/,
    "Expected centers section to expose a dynamic dominant/weakest center summary container.",
  );

  assert.match(
    html,
    /id="centerTypicalActionList"/,
    "Expected centers section to expose a dynamic Action Patterns container.",
  );

  assert.match(
    html,
    /id="centerTypicalThinkingList"/,
    "Expected centers section to expose a dynamic Thinking Patterns container.",
  );

  assert.match(
    html,
    /id="centerTypicalFeelingList"/,
    "Expected centers section to expose a dynamic Feeling Patterns container.",
  );
});

test("center row sorting helper enforces High-to-Low descending order during render", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /const\s+CENTER_LEVEL_SORT_RANK\s*=\s*\{[^}]*High\s*:\s*0[^}]*Medium\s*:\s*1[^}]*Low\s*:\s*2[^}]*"N\/A"\s*:\s*3[^}]*\}/,
    "Expected center level sort rank to prioritize High, then Medium, then Low, then N/A.",
  );

  assert.match(
    script,
    /function\s+sortCenterExpressionRows\s*\(/,
    "Expected a dedicated helper to sort center expression rows.",
  );

  assert.match(
    script,
    /sortCenterExpressionRows\(\s*centerScores\s*\)/,
    "Expected center sorting helper to run in the dashboard render flow.",
  );
});

test("render flow hydrates dynamic centers summary and patterns from active report context", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /setHtml\(\s*'centerDominanceSummary'\s*,/,
    "Expected render flow to hydrate dominant/weakest center summary from active report data.",
  );

  assert.match(
    script,
    /CENTER_PATTERN_COLUMNS\s*=\s*\[[\s\S]*centerTypicalActionList[\s\S]*centerTypicalThinkingList[\s\S]*centerTypicalFeelingList[\s\S]*\]/,
    "Expected centers pattern columns to declare dynamic container IDs for all three pattern groups.",
  );

  assert.match(
    script,
    /setHtml\(\s*column\.listId\s*,\s*renderCenterPatternRows\(/,
    "Expected render flow to hydrate centers pattern columns through the dynamic column config.",
  );

  assert.match(
    script,
    /CENTER_NARRATIVE_SLOTS[\s\S]*setHtml\(\s*slot\.id\s*,/,
    "Expected render flow to hydrate center narrative rows from the active report context.",
  );
});
