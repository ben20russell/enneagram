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

test("profile wheel includes a dedicated right-side legend container", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="profileWheelLegend"/,
    "Expected profile wheel card to include a right-side legend container.",
  );

  assert.match(
    html,
    /id="profileWheelLegendMain"[\s\S]*id="profileWheelLegendRelease"[\s\S]*id="profileWheelLegendStretch"/,
    "Expected profile wheel legend to expose Main, Release, and Stretch value anchors.",
  );
});

test("profile wheel render flow hydrates legend values from active report points", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /profileWheelLegendMain|profileWheelLegendRelease|profileWheelLegendStretch/,
    "Expected profile wheel renderer to hydrate the new legend values at runtime.",
  );
});

test("profile wheel SVG no longer injects role labels on the wheel graphic", () => {
  const script = read(reportJsPath);

  assert.doesNotMatch(
    script,
    /<text class="profile-wheel-role"/,
    "Expected wheel SVG markup to omit in-chart Main/Release/Stretch text labels.",
  );
});
