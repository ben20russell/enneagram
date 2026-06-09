import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("admin review route persists feedback labels and returns ML evaluation metrics", () => {
  const source = read("app/api/admin-review/route.js");
  assert.match(
    source,
    /aggregateMlFeedbackMetricsFromReportRows/,
    "Expected admin review route to aggregate ML feedback metrics for the review dashboard.",
  );
  assert.match(
    source,
    /buildScoreComparisonMetrics/,
    "Expected admin review route to compute parser/model vs ground-truth score error metrics.",
  );
  assert.match(
    source,
    /mlMetrics/,
    "Expected admin review GET response to expose mlMetrics summary.",
  );
});

test("admin import parse persistence routes apply ML score learning before save", () => {
  const routePaths = [
    "app/api/admin-import/route.js",
    "app/api/admin-import/reparse/route.js",
    "app/api/admin-import/apply-parsed/route.js",
  ];

  routePaths.forEach((routePath) => {
    const source = read(routePath);
    assert.match(
      source,
      /applyMlScoreLearningToParsedProfile/,
      `Expected ${routePath} to run ML score learning before persisting parsed profile.`,
    );
  });
});
