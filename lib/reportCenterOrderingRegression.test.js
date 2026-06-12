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

test("centers layout vertically centers wheel and narrative bullets inside the card", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.center-expression-layout\{[^}]*align-items:center[^}]*\}/i,
    "Expected centers two-column layout to vertically center wheel and narrative list content.",
  );

  assert.match(
    html,
    /\.center-expression-col-right\{[^}]*display:flex[^}]*align-items:center[^}]*\}/i,
    "Expected centers narrative column to use flex centering for stable vertical centering with dynamic copy length.",
  );
});

test("centers layout keeps the narrative column tighter and closer to the wheel", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.center-expression-layout\{[^}]*grid-template-columns:minmax\(0,\s*320px\)\s+minmax\(0,\s*460px\)[^}]*gap:14px[^}]*justify-content:center[^}]*\}/i,
    "Expected centers layout to use a tighter fixed two-column footprint and reduced inter-column gap.",
  );

  assert.match(
    html,
    /\.center-expression-col-right\{[^}]*max-width:460px[^}]*\}/i,
    "Expected centers narrative column to cap width for a narrower copy block.",
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
