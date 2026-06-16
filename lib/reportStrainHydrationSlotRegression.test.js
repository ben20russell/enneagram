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

test("strain section exposes overallStrainSummary container for hydration contract checks", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="overallStrainSummary"/,
    "Expected strain section markup to expose an overallStrainSummary hydration container.",
  );
});

test("render flow hydrates overallStrainSummary alongside strain write-up cards", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /setText\(\s*'overallStrainSummary'\s*,/,
    "Expected strain render flow to hydrate overallStrainSummary text before diagnostics checks.",
  );
});
