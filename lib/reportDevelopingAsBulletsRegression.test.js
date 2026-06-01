import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const reportHtmlPath = path.join(process.cwd(), "public", "report.html");
const reportJsPath = path.join(process.cwd(), "public", "report.js");

function read(filePath) {
  return readFileSync(filePath, "utf8");
}

test("developing-as instruction rule remains anchored to page 11 development exercises", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /developingAsCopy\s*:\s*\{[\s\S]*?pageNumbers\s*:\s*\[\s*11\s*\][\s\S]*?startAnchor\s*:\s*"Development Exercise"[\s\S]*?mode\s*:\s*"bullets"/,
    "Expected Developing As extraction rule to stay anchored to page 11 development exercises in bullets mode.",
  );
});

test("spreadsheet focus extraction hydrates dedicated developing-as bullets from anchored page 11 rows", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /extractInstructionBulletRowsFromReportContent\(\s*parsedProfile\s*,\s*ASSIGNED_PDF_INSTRUCTION_RULES\.developingAsCopy/,
    "Expected Developing As extraction to read anchored bullet rows from page 11.",
  );
  assert.match(
    script,
    /developingAsBullets\s*:/,
    "Expected spreadsheet focuses to include a dedicated developingAsBullets field.",
  );
});

test("developing-as card renders bullets in a list container instead of a single paragraph", () => {
  const html = read(reportHtmlPath);
  const script = read(reportJsPath);

  assert.match(
    html,
    /<div[^>]*id="developingAsCopy"[^>]*class="[^"]*tlist[^"]*"|<div[^>]*class="[^"]*tlist[^"]*"[^>]*id="developingAsCopy"/,
    "Expected Developing As container to render as a bullet-list host.",
  );

  assert.match(
    script,
    /setHtml\(\s*'developingAsCopy'\s*,\s*buildAdaptiveListHtml\(/,
    "Expected render flow to hydrate Developing As as bullets.",
  );
});
