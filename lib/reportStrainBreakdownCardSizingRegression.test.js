import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportHtmlPath = path.join(repoRoot, "public", "report.html");
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("strain breakdown card is marked for compact card-size sync and supports internal scroll", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="strainBreakdownCard"/,
    "Expected Strain Area Breakdown card to have a dedicated id for size syncing.",
  );

  assert.match(
    html,
    /\.strain-breakdown-card\s*\{[\s\S]*overflow-y\s*:\s*auto/i,
    "Expected strain breakdown card CSS to allow internal scrolling when compact.",
  );
});

test("report script syncs strain breakdown card height to overall strain write-up card", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /function\s+syncStrainOverviewCardHeight\s*\(/,
    "Expected helper to sync the strain overview card height.",
  );

  assert.match(
    script,
    /syncStrainOverviewCardHeight\(\);/,
    "Expected report render flow to call strain overview card height sync.",
  );
});
