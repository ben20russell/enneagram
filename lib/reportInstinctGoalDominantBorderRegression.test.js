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

test("instinct goals rows expose instinct-code hooks and dominant border classes", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /data-testid="instinct-goal-self-pres-row"[\s\S]*class="stage instinct-goal-row"[\s\S]*data-instinct-code="SP"/,
    "Expected SP instinct-goal row to expose instinct-goal-row class and SP code hook.",
  );

  assert.match(
    html,
    /data-testid="instinct-goal-social-row"[\s\S]*class="stage instinct-goal-row"[\s\S]*data-instinct-code="SO"/,
    "Expected SO instinct-goal row to expose instinct-goal-row class and SO code hook.",
  );

  assert.match(
    html,
    /data-testid="instinct-goal-one-on-one-row"[\s\S]*class="stage instinct-goal-row"[\s\S]*data-instinct-code="SX"/,
    "Expected SX instinct-goal row to expose instinct-goal-row class and SX code hook.",
  );

  assert.match(
    html,
    /\.instinct-goal-row\.is-dominant-sp\{[^}]*border-color:var\(--green\)[^}]*\}/i,
    "Expected dominant SP instinct-goal row to use the green border color.",
  );

  assert.match(
    html,
    /\.instinct-goal-row\.is-dominant-so\{[^}]*border-color:var\(--blue\)[^}]*\}/i,
    "Expected dominant SO instinct-goal row to use the blue border color.",
  );

  assert.match(
    html,
    /\.instinct-goal-row\.is-dominant-sx\{[^}]*border-color:var\(--gold\)[^}]*\}/i,
    "Expected dominant SX instinct-goal row to use the gold border color.",
  );
});

test("render flow applies dominant instinct border state to instinct goal rows", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+resolveDominantInstinctCode\s*\(/,
    "Expected report script to define a dominant instinct code resolver.",
  );

  assert.match(
    script,
    /function\s+renderDominantInstinctGoalBorder\s*\(/,
    "Expected report script to define a renderer for dominant instinct-goal border styling.",
  );

  assert.match(
    script,
    /querySelectorAll\(\s*["']\.instinct-goal-row["']\s*\)/,
    "Expected dominant instinct renderer to clear previous instinct-goal row highlight classes.",
  );

  assert.match(
    script,
    /classList\.add\(\s*`is-dominant-\$\{dominantCode\.toLowerCase\(\)\}`\s*\)/,
    "Expected dominant instinct renderer to add an instinct-specific dominant border class.",
  );

  assert.match(
    script,
    /renderDominantInstinctGoalBorder\(\s*REPORT\.instinct\s*\)/,
    "Expected report render flow to apply dominant instinct-goal border styling from report instinct.",
  );
});
