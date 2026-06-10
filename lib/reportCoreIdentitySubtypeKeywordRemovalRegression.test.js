import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const reportHtmlPath = path.join(process.cwd(), "public", "report.html");
const reportJsPath = path.join(process.cwd(), "public", "report.js");

function read(relativePath) {
  return readFileSync(relativePath, "utf8");
}

test("overview core identity card no longer renders subtype keyword row", () => {
  const source = read(reportHtmlPath);

  assert.doesNotMatch(
    source,
    /<div><div class="kvl">Subtype Keyword<\/div>/,
    "Expected Subtype Keyword row to be removed from the overview Core Identity card.",
  );
});

test("overview render no longer writes subtype keyword into core identity card field", () => {
  const source = read(reportJsPath);

  assert.doesNotMatch(
    source,
    /setText\('keywordValue',\s*REPORT\.keyword\);/,
    "Expected report render flow to stop writing to the removed keywordValue field.",
  );
});

test("overview core identity card contains motivation summary and standalone motivation card is removed", () => {
  const source = read(reportHtmlPath);
  const coreIdentityStart = source.indexOf('<div class="ct">Core Identity</div>');
  const profileCardStart = source.indexOf('<div class="ct">Your Enneagram Profile</div>', coreIdentityStart);
  const coreIdentityBlock =
    coreIdentityStart >= 0 && profileCardStart > coreIdentityStart
      ? source.slice(coreIdentityStart, profileCardStart)
      : "";

  assert.match(
    coreIdentityBlock,
    /id="motivationSummary"/,
    "Expected the Motivation summary field to render inside the overview Core Identity card.",
  );

  assert.doesNotMatch(
    source,
    /data-testid="motivation-card"/,
    "Expected the standalone Motivation card to be removed from the Overview section.",
  );
});

test("overview core identity motivation section renders without a horizontal divider", () => {
  const source = read(reportHtmlPath);
  const coreIdentityStart = source.indexOf('<div class="ct">Core Identity</div>');
  const profileCardStart = source.indexOf('<div class="ct">Your Enneagram Profile</div>', coreIdentityStart);
  const coreIdentityBlock =
    coreIdentityStart >= 0 && profileCardStart > coreIdentityStart
      ? source.slice(coreIdentityStart, profileCardStart)
      : "";

  assert.match(
    coreIdentityBlock,
    /id="traitChips"/,
    "Expected Characteristics chips to remain in the Core Identity card.",
  );
  assert.match(
    coreIdentityBlock,
    /data-testid="core-identity-motivation-label"/,
    "Expected Motivation label to remain in the Core Identity card.",
  );
  assert.doesNotMatch(
    coreIdentityBlock,
    /<div class="div"><\/div>/,
    "Expected the horizontal divider to be removed from the Core Identity card.",
  );
});
