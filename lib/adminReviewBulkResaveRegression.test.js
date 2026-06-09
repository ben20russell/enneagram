import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const routePath = path.join(process.cwd(), "app", "api", "admin-review", "resave-graded", "route.js");

function readRoute() {
  return readFileSync(routePath, "utf8");
}

test("admin review bulk re-save route scopes to imported reports and persists normalized identity fields", () => {
  const source = readRoute();

  assert.match(
    source,
    /\.from\(table\)\s*\.select\("id,user_email,enneagram_type,results_data,report_pdf"\)\s*\.eq\("source",\s*"admin-import"\)\s*\.order\("created_at",\s*\{\s*ascending:\s*false\s*\}\)\s*\.range\(offset,\s*toIndex\)/s,
    "Expected bulk re-save route to scope to admin-import reports and load required fields.",
  );

  assert.match(
    source,
    /\.update\(\{\s*results_data:\s*nextResults,\s*enneagram_type:\s*persistedEnneagramTypeNumber\s*\}\)/s,
    "Expected bulk re-save route to persist both results_data and enneagram_type columns.",
  );

  assert.match(
    source,
    /admin-review:bulk-resave/,
    "Expected bulk re-save route to mark dashboard detectedTypeSource as bulk-resave.",
  );
});

test("admin review bulk re-save route returns summary metrics for admin visibility", () => {
  const source = readRoute();

  assert.match(
    source,
    /NextResponse\.json\(/,
    "Expected bulk re-save route to return processing summary and failures list.",
  );

  assert.match(source, /success:\s*true/);
  assert.match(source, /processedCount/);
  assert.match(source, /updatedCount/);
  assert.match(source, /skippedCount/);
  assert.match(source, /failedCount/);
  assert.match(source, /scannedCount/);
  assert.match(source, /gradedCount/);
  assert.match(source, /failures/);
});
