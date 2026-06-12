import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("dashboard narrative cleanup route requests strict validation envelope from LLM", () => {
  const routePath = path.join(
    process.cwd(),
    "app",
    "api",
    "report-hydration",
    "dashboard-copy",
    "cleanup",
    "route.js",
  );
  const routeSource = readFileSync(routePath, "utf8");

  assert.match(
    routeSource,
    /name:\s*"dashboard_copy_hydration_cleanup_strict"/,
    "Expected cleanup route to use a strict schema envelope name for programmatic validation.",
  );
  assert.match(
    routeSource,
    /required:\s*\[\s*"cleanedPayload"\s*,\s*"validation"\s*\]/,
    "Expected strict schema envelope to require cleanedPayload and validation blocks.",
  );
  assert.match(
    routeSource,
    /metadataRemoved:\s*\{\s*type:\s*"array"/,
    "Expected strict schema to capture removed metadata tokens for auditability.",
  );
  assert.match(
    routeSource,
    /qualityChecks:\s*\{\s*type:\s*"object"/,
    "Expected strict schema to include quality check booleans for pipeline gating.",
  );
  assert.match(
    routeSource,
    /status:\s*\{\s*type:\s*"string"\s*,\s*enum:\s*COPY_CLEANUP_STATUS_VALUES/,
    "Expected strict schema to include validation status gating.",
  );
});

test("dashboard narrative cleanup route supports strict parsed envelope and deterministic fallback validation", () => {
  const routePath = path.join(
    process.cwd(),
    "app",
    "api",
    "report-hydration",
    "dashboard-copy",
    "cleanup",
    "route.js",
  );
  const routeSource = readFileSync(routePath, "utf8");

  assert.match(
    routeSource,
    /message\?\.parsed\?\.cleanedPayload/,
    "Expected route parser to read cleanedPayload from the strict parsed response envelope.",
  );
  assert.match(
    routeSource,
    /message\?\.parsed\?\.validation/,
    "Expected route parser to read validation metadata from the strict parsed response envelope.",
  );
  assert.match(
    routeSource,
    /function\s+buildDeterministicValidationResult\s*\(/,
    "Expected cleanup route to compute deterministic validation result when the model does not return complete metadata.",
  );
  assert.match(
    routeSource,
    /copyCleanupValidation:/,
    "Expected route response payload to include copyCleanupValidation for downstream programmatic checks.",
  );
});

test("dashboard hydration client logs strict validation signals from cleanup route", () => {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");

  assert.match(
    scriptSource,
    /copyCleanupValidation/,
    "Expected client hydration flow to read copyCleanupValidation metadata from cleanup route response.",
  );
  assert.match(
    scriptSource,
    /validationStatus:\s*copyCleanupValidation\?\.status/,
    "Expected cleanup completion logs to surface strict validation status.",
  );
  assert.match(
    scriptSource,
    /if\s*\(\s*copyCleanupValidation\?\.status\s*===\s*"needs_review"\s*\)/,
    "Expected client hydration flow to explicitly handle needs_review validation status.",
  );
});
