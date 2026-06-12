import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("render flow applies example-mode spreadsheet fallback copy so section text always refreshes", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /const\s+spreadsheetFocusFallbacks\s*=\s*isExampleMode\s*\?\s*buildSpreadsheetFocusFallbacks\(\s*REPORT\s*,\s*adaptiveCopy\s*\)\s*:\s*\{\s*\}\s*;/,
    "Expected render flow to derive spreadsheet fallback content in example mode.",
  );

  assert.match(
    script,
    /spreadsheetFocusFallbacks\.motivationSummary/,
    "Expected motivation summary hydration to use example-mode fallback content when report data is sparse.",
  );

  assert.match(
    script,
    /spreadsheetFocusFallbacks\.conflictResponseCopy/,
    "Expected conflict response hydration to use example-mode fallback content.",
  );

});

test("team stage hydration uses adaptive fallback copy in example mode", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /const\s+teamStageFallbacks\s*=\s*isExampleMode\s*\?\s*\(\s*adaptiveCopy\?\.teamStages\s*\|\|\s*\{\s*\}\s*\)\s*:\s*\{\s*\}\s*;/,
    "Expected render flow to build team-stage fallback copy from adaptive section content in example mode.",
  );

  assert.match(
    script,
    /firstPresentSnippet\(\s*\[\s*teamStagesFromReport\.forming\s*,\s*teamStageFallbacks\.forming\s*\]/,
    "Expected Forming stage hydration to fallback to adaptive copy when report payload is missing.",
  );

  assert.match(
    script,
    /firstPresentSnippet\(\s*\[\s*teamStagesFromReport\.performing\s*,\s*teamStageFallbacks\.performing\s*\]/,
    "Expected Performing stage hydration to fallback to adaptive copy when report payload is missing.",
  );
});

test("growth key challenges panel is hydrated from active report context on each switch", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /function\s+renderGrowthKeyChallenges\s*\(/,
    "Expected a dedicated key-challenges renderer tied to active report state.",
  );

  assert.match(
    script,
    /renderGrowthKeyChallenges\(\s*\{\s*report:\s*REPORT\s*,\s*isExampleMode\s*\}\s*\)/,
    "Expected render flow to re-hydrate key challenges every time the active report changes.",
  );
});
