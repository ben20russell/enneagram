import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const routePath = path.join(process.cwd(), "app", "api", "admin-review", "route.js");

function readRoute() {
  return readFileSync(routePath, "utf8");
}

test("admin review save updates both results_data and enneagram_type columns", () => {
  const source = readRoute();

  assert.match(
    source,
    /\.select\("id,enneagram_type,results_data,report_pdf"\)/,
    "Expected admin review save path to load existing enneagram_type before update.",
  );

  assert.match(
    source,
    /\.update\(\{\s*results_data:\s*nextResults,[\s\S]*?enneagram_type:\s*resolvedPrimaryType\s*\|\|\s*row\?\.enneagram_type\s*\|\|\s*null,?\s*\}\)/s,
    "Expected admin review save path to persist both results_data and enneagram_type columns.",
  );
});

test("admin review save derives primary type from graded type scores for dashboard hydration", () => {
  const source = readRoute();

  assert.match(
    source,
    /function\s+resolvePrimaryTypeFromTypeScores\(/,
    "Expected admin review route to derive primary type from reviewed type scores.",
  );

  assert.match(
    source,
    /const\s+resolvedPrimaryType\s*=\s*resolvePrimaryTypeFromTypeScores\(/,
    "Expected admin review save path to resolve primary type from score updates.",
  );

  assert.match(
    source,
    /parsedProfile:\s*nextProfileWithResolvedType/,
    "Expected persisted parsed profile to include the resolved primary type.",
  );

  assert.match(
    source,
    /dashboardContext:\s*\{[\s\S]*detectedType:\s*resolvedPrimaryType\s*\|\|[\s\S]*\}/,
    "Expected dashboard context to keep detected type in sync after grading.",
  );
});
