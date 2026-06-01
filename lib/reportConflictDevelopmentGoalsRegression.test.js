import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const reportHtmlPath = path.join(process.cwd(), "public", "report.html");
const reportJsPath = path.join(process.cwd(), "public", "report.js");

function read(filePath) {
  return readFileSync(filePath, "utf8");
}

test("conflict development-goals instruction rule is anchored to page 31", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /conflictDevelopmentGoals\s*:\s*\{[\s\S]*?pageNumbers\s*:\s*\[\s*31\s*\][\s\S]*?startAnchor\s*:\s*"Development goals"[\s\S]*?endAnchor\s*:\s*"end of page"[\s\S]*?mode\s*:\s*"bullets"/,
    "Expected Development goals extraction rule to target page 31 in bullets mode.",
  );
});

test("spreadsheet focus extraction pulls page-31 development goals into triggered-pattern bullets", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /extractInstructionBulletRowsFromReportContent\(\s*parsedProfile\s*,\s*ASSIGNED_PDF_INSTRUCTION_RULES\.conflictDevelopmentGoals/,
    "Expected focused extraction to read Development goals bullet rows from page 31.",
  );

  assert.match(
    script,
    /conflictTriggeredBullets\s*:/,
    "Expected spreadsheet focuses to include conflictTriggeredBullets for bullet hydration.",
  );
});

test("conflict response card renders both sections as bullet-list containers", () => {
  const html = read(reportHtmlPath);
  const script = read(reportJsPath);

  assert.match(
    html,
    /id="conflictResponseCopy"[^>]*class="[^"]*tlist[^"]*"|class="[^"]*tlist[^"]*"[^>]*id="conflictResponseCopy"/,
    "Expected conflict response container to be a bullet-list host.",
  );

  assert.match(
    html,
    /id="conflictTriggeredCopy"[^>]*class="[^"]*tlist[^"]*"|class="[^"]*tlist[^"]*"[^>]*id="conflictTriggeredCopy"/,
    "Expected triggered pattern container to be a bullet-list host.",
  );

  assert.match(
    script,
    /setHtml\(\s*'conflictResponseCopy'\s*,\s*renderNarrativeBullets\(/,
    "Expected render flow to hydrate conflict response as bullets.",
  );

  assert.match(
    script,
    /setHtml\(\s*'conflictTriggeredCopy'\s*,/,
    "Expected render flow to hydrate triggered pattern as bullet rows.",
  );
});
