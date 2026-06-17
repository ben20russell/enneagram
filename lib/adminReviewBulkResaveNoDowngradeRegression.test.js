import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readRouteSource() {
  return readFileSync(
    path.join(process.cwd(), "app", "api", "admin-review", "resave-graded", "route.js"),
    "utf8",
  );
}

test("admin review bulk re-save defines parsed-content richness and parse-state helpers", () => {
  const source = readRouteSource();
  assert.match(
    source,
    /function\s+hasRichParsedReportContent\s*\(/,
    "Expected bulk re-save route to define a parsed-content richness helper.",
  );
  assert.match(
    source,
    /function\s+resolveProfileParseState\s*\(/,
    "Expected bulk re-save route to define a parse-state resolver helper.",
  );
});

test("admin review bulk re-save prefers existing parsed profile when pipeline parse fails", () => {
  const source = readRouteSource();
  assert.match(
    source,
    /const\s+shouldPreferExistingProfile\s*=\s*Boolean\(existingProfile\)\s*&&\s*\([\s\S]*parsedPipelineState\s*===\s*"failed"[\s\S]*\)/,
    "Expected bulk re-save route to prefer existing parsed profile on failed pipeline parse state.",
  );
  assert.match(
    source,
    /const\s+activeProfile\s*=\s*shouldPreferExistingProfile\s*\?\s*existingProfile\s*:\s*\(parsedPipelineProfile\s*\|\|\s*existingProfile\)/,
    "Expected active profile selection to preserve existing parsed profile when downgrade risk is detected.",
  );
});
