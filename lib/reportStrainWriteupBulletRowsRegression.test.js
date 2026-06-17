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

test("strain write-up cards support bullet rows styling", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.strain-detail-list\s*\{/,
    "Expected strain write-up list CSS class to be defined.",
  );

  assert.match(
    html,
    /\.strain-detail-row-icon\s*\{/,
    "Expected strain write-up row icon CSS class to be defined.",
  );
});

test("strain write-up rendering formats non-overall detail as row-based bullet items", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /function\s+formatStrainCardDetailContent\s*\(/,
    "Expected a formatter for strain card detail body rendering.",
  );

  assert.match(
    script,
    /if\s*\(\s*item\.key\s*===\s*"overall"\s*\)\s*\{\s*return\s*`<p/i,
    "Expected Overall Strain card to remain paragraph-based.",
  );

  assert.match(
    script,
    /formatStrainCardDetailContent\(\s*detail\s*,\s*item\s*\)/,
    "Expected non-overall card detail to use row-based formatter.",
  );

  assert.match(
    script,
    /class="tlist strain-detail-list"/,
    "Expected non-overall strain cards to render row-based bullet list markup.",
  );
});

test("strain write-up formatter uses narrative splitting so every strain type card keeps bullet rows", () => {
  const script = read(reportScriptPath);
  const formatterSource =
    script.match(/function\s+formatStrainCardDetailContent\s*\([\s\S]*?\n\}/)?.[0] || "";

  assert.ok(
    formatterSource,
    "Expected to locate the strain write-up formatter function source.",
  );

  assert.match(
    formatterSource,
    /extractNarrativeBulletItems\(\s*normalizedDetail\s*,\s*6\s*\)/,
    "Expected strain write-up formatter to split narrative detail into bullet rows for all non-overall strain cards.",
  );
});
