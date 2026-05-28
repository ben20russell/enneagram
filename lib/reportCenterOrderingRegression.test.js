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
