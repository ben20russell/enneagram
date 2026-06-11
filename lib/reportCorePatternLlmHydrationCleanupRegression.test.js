import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("dashboard hydration folds core pattern cleanup into dashboard-wide cleanup payload", () => {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");

  assert.match(
    scriptSource,
    /async function hydrateDashboardNarrativesWithLlmCleanup\(/,
    "Expected report hydration script to define a dashboard-wide cleanup helper.",
  );

  assert.match(
    scriptSource,
    /await\s+hydrateDashboardNarrativesWithLlmCleanup\(\s*\{[\s\S]*?corePatternBullets[\s\S]*?\}\s*\)/,
    "Expected assigned-report hydration to include corePatternBullets in the dashboard-wide cleanup call.",
  );

  assert.doesNotMatch(
    scriptSource,
    /corePatternBullets\s*=\s*await\s*hydrateCorePatternBulletsWithLlmCleanup\(\s*\{/,
    "Expected ingest flow to avoid a separate core-pattern-only cleanup pass after folding into dashboard-wide cleanup.",
  );
});

test("core pattern cleanup route includes retry policy and section boundary guards", () => {
  const routePath = path.join(
    process.cwd(),
    "app",
    "api",
    "report-hydration",
    "core-patterns",
    "cleanup",
    "route.js",
  );

  assert.equal(
    existsSync(routePath),
    true,
    "Expected a dedicated API route for LLM core-pattern hydration cleanup.",
  );

  const routeSource = readFileSync(routePath, "utf8");
  assert.match(
    routeSource,
    /const OPENAI_RETRY_BASE_DELAYS_MS\s*=\s*\[\s*500,\s*1000,\s*2000,\s*4000,\s*8000\s*\]/,
    "Expected core-pattern cleanup route to implement exponential retry delays.",
  );
  assert.match(
    routeSource,
    /STREAM_DISCONNECT_ERROR_SIGNATURE/,
    "Expected core-pattern cleanup route to treat stream disconnect failures as retryable.",
  );
  assert.match(
    routeSource,
    /Blind Spots/,
    "Expected core-pattern cleanup instructions to exclude Blind Spots spillover from section text.",
  );
  assert.match(
    routeSource,
    /Worldview/,
    "Expected core-pattern cleanup instructions to exclude Worldview spillover from section text.",
  );
});
