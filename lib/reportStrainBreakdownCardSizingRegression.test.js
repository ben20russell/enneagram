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
    /\.strain-breakdown-scroll\s*\{[\s\S]*overflow-y\s*:\s*auto/i,
    "Expected strain breakdown rows container CSS to allow internal scrolling when compact.",
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

test("strain section uses a shared three-column grid so breakdown and write-up cards have matching widths", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="strainCardsGrid"[\s\S]*id="strainBreakdownCard"[\s\S]*id="strainWriteupCards"/,
    "Expected strain cards grid to contain the breakdown card and write-up cards container.",
  );

  assert.match(
    html,
    /\.strain-cards-grid\s*\{[\s\S]*grid-template-columns\s*:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/i,
    "Expected strain cards grid to render in 3 equal columns.",
  );

  assert.match(
    html,
    /\.strain-cards-pack\s*\{[\s\S]*display\s*:\s*contents/i,
    "Expected strain write-up cards container to flow card items into the shared 3-column grid.",
  );
});
