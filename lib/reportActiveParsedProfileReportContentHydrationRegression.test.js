import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const routePath = path.join(repoRoot, "app", "api", "report-active", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("report-active hydrates parsedProfile.reportContent from extractedContent when parsed pages are missing", () => {
  const source = read(routePath);

  assert.match(
    source,
    /function\s+hydrateParsedProfileReportContent\s*\(/,
    "Expected report-active route to define parsedProfile report-content hydration helper.",
  );

  assert.match(
    source,
    /normalized\?\.extractedContent/,
    "Expected report-active parsedProfile hydration to use extractedContent fallback payload.",
  );

  assert.match(
    source,
    /pages:\s*shouldHydratePages\s*\?\s*extractedPages\s*:\s*parsedPages/,
    "Expected parsedProfile report-content pages to fallback to extractedContent pages when needed.",
  );
});
