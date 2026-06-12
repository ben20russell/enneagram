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

test("centers section exposes center wheel and sortable narrative rows", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="centerExpressionWheel"/,
    "Expected centers section to expose a dedicated wheel container for score visualization.",
  );

  assert.match(
    html,
    /data-center-row="body"[\s\S]*data-center-row="heart"[\s\S]*data-center-row="head"/,
    "Expected center narratives to carry center-key attributes for deterministic re-ordering.",
  );

  assert.match(
    html,
    /id="centerExpressionNarratives"/,
    "Expected centers narrative list to expose a sortable container.",
  );
});

test("centers section removes dominant summary copy and keeps dynamic pattern columns", () => {
  const html = read(reportHtmlPath);

  assert.doesNotMatch(
    html,
    /id="centerDominanceSummary"/,
    "Expected centers section to remove the dominant/weakest summary copy container.",
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

test("centers layout stacks wheel and narrative bullets in one narrow card", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.center-expression-layout\{[^}]*display:flex[^}]*flex-direction:column[^}]*align-items:center[^}]*\}/i,
    "Expected centers layout to stack wheel and bullets vertically in one column.",
  );

  assert.match(
    html,
    /id="centerExpressionWheel"[\s\S]*id="centerExpressionNarratives"/,
    "Expected bulleted center narratives to render beneath the wheel inside the same card.",
  );
});

test("centers layout makes the center-expression card narrow and positions typical patterns to its right", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.center-sections-layout\{[^}]*grid-template-columns:minmax\(0,\s*520px\)\s+minmax\(0,\s*1fr\)[^}]*gap:14px[^}]*\}/i,
    "Expected centers section to use a two-card layout with a narrow center-expression column and patterns on the right.",
  );

  assert.match(
    html,
    /\.center-expression-card\{[^}]*max-width:520px[^}]*\}/i,
    "Expected center-expression card width to be capped for the requested half-width visual footprint.",
  );

  assert.match(
    html,
    /class="center-sections-layout mb24"[\s\S]*class="card center-expression-card"[\s\S]*<div class="ct">Centers of Expression<\/div>[\s\S]*class="card center-patterns-card"[\s\S]*<div class="ct">Typical Patterns<\/div>/,
    "Expected Typical Patterns card to sit to the right of the Centers of Expression card in the same top-row layout.",
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

test("render flow hydrates center wheel and pattern copy from active report context", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+renderCenterExpressionWheel\s*\(/,
    "Expected report script to define a center wheel renderer.",
  );

  assert.match(
    script,
    /renderCenterExpressionWheel\(\s*centerScores\s*\)/,
    "Expected render flow to hydrate the center wheel from active report center scores.",
  );

  assert.doesNotMatch(
    script,
    /setHtml\(\s*'centerDominanceSummary'\s*,/,
    "Expected render flow to avoid injecting removed dominant/weakest summary copy.",
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

test("center wheel arc labels use American Center spelling without forced in-word spacing", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /const\s+svgPadding\s*=\s*\d+\s*;/,
    "Expected center wheel renderer to define explicit SVG padding so curved labels do not clip at edges.",
  );

  assert.match(
    script,
    /viewBox="\$\{viewBoxMin\}\s+\$\{viewBoxMin\}\s+\$\{viewBoxSize\}\s+\$\{viewBoxSize\}"/,
    "Expected center wheel SVG to use a padded square viewBox.",
  );

  assert.match(
    script,
    /ACTION CENTER[\s\S]*FEELING CENTER[\s\S]*THINKING CENTER/,
    "Expected center wheel sectors to use American 'CENTER' spelling.",
  );

  assert.doesNotMatch(
    script,
    /CENTRE/,
    "Expected center wheel renderer to avoid British 'CENTRE' spelling.",
  );

  assert.doesNotMatch(
    script,
    /textLength="\$\{labelTextLength\}"|lengthAdjust="spacing"/,
    "Expected center wheel textPath labels to avoid forced spacing/stretch attributes.",
  );

  assert.doesNotMatch(
    script,
    /letter-spacing="0\.22"|letter-spacing="0\.7"/,
    "Expected center wheel labels to avoid extra in-word letter spacing.",
  );
});

test("center wheel LOW label uses a smaller font size than HIGH", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /const\s+fontSize\s*=\s*level\s*===\s*"LOW"\s*\?\s*20\s*:\s*level\s*===\s*"MEDIUM"\s*\?\s*26\s*:\s*level\s*===\s*"N\/A"\s*\?\s*20\s*:\s*32\s*;/,
    "Expected center wheel LOW label font-size to be reduced to 20 for fit inside the red sector.",
  );
});
