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

test("instinct goals card removes developing-as copy and uses the streamlined section title", () => {
  const html = read(reportHtmlPath);
  const script = read(reportJsPath);

  assert.match(
    html,
    /<div class="ct">Instinctual Goals<\/div>/,
    "Expected instinct goals card to use the short title copy.",
  );

  assert.doesNotMatch(
    html,
    /Instinctual Goals &amp; Development/,
    "Expected instinct goals card to remove the legacy '& Development' title suffix.",
  );

  assert.doesNotMatch(
    html,
    /id="developingAsCopy"|Developing As\.\.\./,
    "Expected instinct goals card to remove the Developing As block.",
  );

  assert.doesNotMatch(
    script,
    /setHtml\(\s*'developingAsCopy'\s*,\s*buildAdaptiveListHtml\(/,
    "Expected render flow to stop hydrating the removed Developing As container.",
  );
});
