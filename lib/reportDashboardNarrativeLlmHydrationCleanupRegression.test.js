import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("dashboard hydration runs LLM cleanup for narrative copy before applying the assigned report", () => {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");

  assert.match(
    scriptSource,
    /async function hydrateDashboardNarrativesWithLlmCleanup\(/,
    "Expected dashboard script to define a dedicated LLM cleanup helper for narrative copy.",
  );

  assert.match(
    scriptSource,
    /await\s+hydrateDashboardNarrativesWithLlmCleanup\(\s*\{[\s\S]*?corePatternBullets[\s\S]*?strainQualitativeWriteups[\s\S]*?developmentExercises[\s\S]*?spreadsheetFocuses[\s\S]*?\}\s*\)/,
    "Expected assigned-report hydration flow to run core-pattern and narrative copy through one dashboard-wide LLM cleanup pass.",
  );

  assert.match(
    scriptSource,
    /\/api\/report-hydration\/dashboard-copy\/cleanup/,
    "Expected dashboard narrative cleanup helper to post to a dedicated hydration route.",
  );
});

test("dashboard narrative cleanup route includes retry policy and section-boundary guards", () => {
  const routePath = path.join(
    process.cwd(),
    "app",
    "api",
    "report-hydration",
    "dashboard-copy",
    "cleanup",
    "route.js",
  );

  assert.equal(
    existsSync(routePath),
    true,
    "Expected a dedicated API route for dashboard narrative LLM cleanup.",
  );

  const routeSource = readFileSync(routePath, "utf8");
  assert.match(
    routeSource,
    /const OPENAI_RETRY_BASE_DELAYS_MS\s*=\s*\[\s*500,\s*1000,\s*2000,\s*4000,\s*8000\s*\]/,
    "Expected dashboard narrative cleanup route to implement exponential retry delays.",
  );
  assert.match(
    routeSource,
    /STREAM_DISCONNECT_ERROR_SIGNATURE/,
    "Expected dashboard narrative cleanup route to treat stream disconnect failures as retryable.",
  );
  assert.match(
    routeSource,
    /One-On-One - SX/,
    "Expected dashboard cleanup instructions to preserve SX-only instinct copy in the One-On-One field.",
  );
  assert.match(
    routeSource,
    /Social - SO/,
    "Expected dashboard cleanup instructions to preserve SO-only instinct copy in the Social field.",
  );
  assert.match(
    routeSource,
    /Self-Preservation - SP/,
    "Expected dashboard cleanup instructions to preserve SP-only instinct copy in the Self-Preservation field.",
  );
  assert.match(
    routeSource,
    /Development Exercise/,
    "Expected dashboard cleanup instructions to trim Development Exercise heading spillover.",
  );
  assert.match(
    routeSource,
    /corePatternBullets/,
    "Expected dashboard cleanup route schema to include corePatternBullets in the same cleanup payload.",
  );
  assert.match(
    routeSource,
    /Typical Action Patterns/,
    "Expected dashboard cleanup route to preserve the Typical Action Patterns section label.",
  );
  assert.match(
    routeSource,
    /Typical Thinking Patterns/,
    "Expected dashboard cleanup route to preserve the Typical Thinking Patterns section label.",
  );
  assert.match(
    routeSource,
    /Typical Feeling Patterns/,
    "Expected dashboard cleanup route to preserve the Typical Feeling Patterns section label.",
  );
});
