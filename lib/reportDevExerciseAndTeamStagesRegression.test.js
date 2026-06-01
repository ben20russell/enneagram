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

test("growth section exposes a dedicated DevExercise component shell", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="devExerciseComponent"/,
    "Expected a dedicated DevExercise component container in the Growth section.",
  );

  assert.match(
    html,
    /id="devExerciseSummary"/,
    "Expected DevExercise component to expose a summary container for integration/strain-aware guidance.",
  );

  assert.match(
    html,
    /id="devExercisePaths"/,
    "Expected DevExercise component to expose a dynamic list container for personalized growth paths.",
  );

  assert.match(
    html,
    /id="growthKeyChallengesBox"/,
    "Expected Growth section to expose a dedicated static key-challenges shell that can be toggled by report mode.",
  );
});

test("leadership section exposes Team Stage Breakdown rows for all Tuckman boundaries", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="teamStageBreakdownCard"/,
    "Expected a dedicated Team Stage Breakdown card container.",
  );

  assert.match(
    html,
    /id="teamStageForming"/,
    "Expected Team Stage Breakdown to include Forming stage row.",
  );

  assert.match(
    html,
    /id="teamStageStorming"/,
    "Expected Team Stage Breakdown to include Storming stage row.",
  );

  assert.match(
    html,
    /id="teamStageNorming"/,
    "Expected Team Stage Breakdown to include Norming stage row.",
  );

  assert.match(
    html,
    /id="teamStagePerforming"/,
    "Expected Team Stage Breakdown to include Performing stage row.",
  );
});

test("report render flow hydrates DevExercise component from integration and strain context", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+buildDevExerciseComponentData\s*\(/,
    "Expected a builder function that composes DevExercise data from report context.",
  );

  assert.match(
    script,
    /setText\(\s*'devExerciseSummary'\s*,/,
    "Expected render flow to hydrate DevExercise summary copy.",
  );

  assert.match(
    script,
    /setHtml\(\s*'devExercisePaths'\s*,/,
    "Expected render flow to hydrate personalized DevExercise path rows.",
  );

  assert.match(
    script,
    /growthKeyChallengesBox\.style\.display\s*=\s*isExampleMode\s*\?\s*"block"\s*:\s*"none"/,
    "Expected static key-challenges panel to hide when rendering assigned/client reports.",
  );
});

test("report extraction includes structured Team Stage breakdown hydration", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+extractTeamStageBreakdownFromReportContent\s*\(/,
    "Expected structured report extraction helper for Team Stage breakdown.",
  );

  assert.match(
    script,
    /set(?:Text|Html)\(\s*'teamStageForming'\s*,/,
    "Expected render flow to hydrate Forming stage guidance from active report context.",
  );

  assert.match(
    script,
    /set(?:Text|Html)\(\s*'teamStageStorming'\s*,/,
    "Expected render flow to hydrate Storming stage guidance from active report context.",
  );

  assert.match(
    script,
    /set(?:Text|Html)\(\s*'teamStageNorming'\s*,/,
    "Expected render flow to hydrate Norming stage guidance from active report context.",
  );

  assert.match(
    script,
    /set(?:Text|Html)\(\s*'teamStagePerforming'\s*,/,
    "Expected render flow to hydrate Performing stage guidance from active report context.",
  );
});
