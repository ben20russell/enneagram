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

test("profile wheel role labels do not hard-force centered anchor in CSS", () => {
  const html = read(reportHtmlPath);
  const roleCssMatch = html.match(/\.profile-wheel-role\s*\{([\s\S]*?)\}/);

  assert.ok(roleCssMatch?.[1], "Expected .profile-wheel-role CSS block");
  assert.doesNotMatch(
    roleCssMatch[1],
    /text-anchor\s*:\s*middle/i,
    "Role labels should respect runtime SVG text-anchor for visibility",
  );
});

test("profile wheel rendering includes role label collision guard", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /badgeCollisionBoundaryX|badgeSafeZone|collid/i,
    "Expected profile wheel role labels to include overlap-avoidance logic near badge",
  );
});

test("profile wheel role labels anchor outward from the wheel to avoid ring overlap", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /roleAnchor\s*=\s*roleTextX\s*>=\s*cx\s*\?\s*"start"\s*:\s*"end"/,
    "Expected role labels to use outward-facing text anchors instead of centered placement",
  );
});
