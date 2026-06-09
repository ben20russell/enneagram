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
