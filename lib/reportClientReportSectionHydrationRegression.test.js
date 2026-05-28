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

test("non-strain tab sections expose dynamic containers for report-driven hydration", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="leadershipIntroCopy"/,
    "Expected Leadership intro copy to render via a dynamic container instead of hardcoded Type 8 text.",
  );

  assert.match(
    html,
    /id="strengthsList"/,
    "Expected Strengths section list to expose a dynamic container for report switching.",
  );

  assert.match(
    html,
    /id="communicationPatternList"/,
    "Expected Communication pattern list to expose a dynamic container for report switching.",
  );

  assert.doesNotMatch(
    html,
    /Your type 8 style focuses management efforts on directing action toward the vision and taking charge\./,
    "Expected legacy hardcoded Type 8 leadership copy to be removed from static HTML.",
  );
});

test("render flow hydrates dynamic section containers from active report context", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+buildAdaptiveSectionCopy\s*\(/,
    "Expected adaptive section copy builder for non-strain tabs.",
  );

  assert.match(
    script,
    /setHtml\(\s*'strengthsList'\s*,/,
    "Expected render flow to hydrate Strengths list from the active report object.",
  );

  assert.match(
    script,
    /setHtml\(\s*'leadershipGoalList'\s*,/,
    "Expected render flow to hydrate Leadership goal bullets from active report context.",
  );

  assert.match(
    script,
    /setHtml\(\s*'communicationPatternList'\s*,/,
    "Expected render flow to hydrate Communication pattern bullets from active report context.",
  );
});
