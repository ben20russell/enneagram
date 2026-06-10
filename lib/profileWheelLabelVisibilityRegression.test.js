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

test("profile wheel removes external legend container when labels are integrated into the chart", () => {
  const html = read(reportHtmlPath);

  assert.doesNotMatch(
    html,
    /id="profileWheelLegend"/,
    "Expected profile wheel card to remove the right-side legend container.",
  );

  assert.doesNotMatch(
    html,
    /profile-wheel-legend/,
    "Expected profile wheel markup to avoid standalone legend classes once labels move in-wheel.",
  );
});

test("profile wheel render flow no longer hydrates external legend value anchors", () => {
  const script = read(reportJsPath);

  assert.doesNotMatch(
    script,
    /profileWheelLegendMain|profileWheelLegendRelease|profileWheelLegendStretch/,
    "Expected profile wheel renderer to avoid legacy external legend hydration.",
  );
});

test("profile wheel SVG injects integrated role labels on highlighted segments", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /<text class="profile-wheel-role\s+profile-wheel-role-\$\{role\.key\}"/,
    "Expected wheel SVG markup to include integrated Main/Release/Stretch labels.",
  );

  assert.match(
    script,
    /MAIN|RELEASE|STRETCH/,
    "Expected wheel renderer to declare integrated role label copy.",
  );
});

test("profile wheel uses a smaller visual footprint for the chart image", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.profile-wheel-wrap\{[\s\S]*--profile-wheel-size:\s*332px[\s\S]*min-height:\s*var\(--profile-wheel-size\)/i,
    "Expected profile wheel wrapper to define a smaller desktop wheel size token.",
  );

  assert.match(
    html,
    /@media\(max-width:700px\)\{[\s\S]*--profile-wheel-size:\s*268px/i,
    "Expected profile wheel wrapper to define a smaller mobile wheel size.",
  );
});

test("profile wheel layout keeps a centered single-column square region", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.profile-wheel-wrap\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*var\(--profile-wheel-size\)\)/i,
    "Expected profile wheel layout to use a single centered wheel column.",
  );

  assert.match(
    html,
    /\.profile-wheel\{[\s\S]*aspect-ratio:\s*1\s*\/\s*1/i,
    "Expected profile wheel container to preserve a square aspect ratio for tighter image framing.",
  );
});

test("profile wheel renderer uses a tighter square svg viewBox", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /const\s+wheelPadding\s*=\s*10\s*;/,
    "Expected profile wheel renderer to use tighter wheel padding for reduced blank space framing.",
  );

  assert.match(
    script,
    /viewBox="\$\{viewBoxX\}\s+\$\{viewBoxY\}\s+\$\{viewBoxSize\}\s+\$\{viewBoxSize\}"/,
    "Expected profile wheel SVG viewBox to use a square, tighter framing around wheel geometry.",
  );
});
