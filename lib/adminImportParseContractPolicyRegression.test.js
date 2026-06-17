import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportRoutePath = path.join(repoRoot, "app", "api", "admin-import", "route.js");
const reparseRoutePath = path.join(repoRoot, "app", "api", "admin-import", "reparse", "route.js");
const applyParsedRoutePath = path.join(repoRoot, "app", "api", "admin-import", "apply-parsed", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import routes no longer gate completeness on full chart score population", () => {
  const reparseSource = read(reparseRoutePath);
  const applySource = read(applyParsedRoutePath);

  assert.doesNotMatch(
    reparseSource,
    /const\s+hasAllChartScores[\s\S]*const\s+isComplete\s*=\s*hasMinPages\s*&&\s*hasAllChartScores/,
    "Expected reparse route completeness to avoid hard gating on all chart scores.",
  );

  assert.doesNotMatch(
    applySource,
    /const\s+hasAllChartScores[\s\S]*const\s+isComplete\s*=\s*hasMinPages\s*&&\s*hasAllChartScores/,
    "Expected apply-parsed route completeness to avoid hard gating on all chart scores.",
  );
});

test("admin import routes include normalized parse contract fields", () => {
  const adminImportSource = read(adminImportRoutePath);
  const reparseSource = read(reparseRoutePath);
  const applySource = read(applyParsedRoutePath);

  for (const source of [adminImportSource, reparseSource, applySource]) {
    assert.match(
      source,
      /parseCoverage:\s*\{/,
      "Expected parse route responses to include parseCoverage contract object.",
    );

    assert.match(
      source,
      /verificationSummary:\s*\{/,
      "Expected parse route responses to include verificationSummary contract object.",
    );

    assert.match(
      source,
      /parseState:/,
      "Expected parse route responses to include parseState field.",
    );

    assert.match(
      source,
      /parseReason:/,
      "Expected parse route responses to include parseReason field.",
    );

    assert.match(
      source,
      /parseNoise:/,
      "Expected parse route responses to include parseNoise field.",
    );
  }
});

test("admin import routes determine completeness from detected page coverage before min-page fallback", () => {
  const adminImportSource = read(adminImportRoutePath);
  const reparseSource = read(reparseRoutePath);
  const applySource = read(applyParsedRoutePath);

  for (const source of [adminImportSource, reparseSource, applySource]) {
    assert.match(
      source,
      /const\s+coverageTarget\s*=\s*detectedTotalPages\s*\|\|\s*minPages\s*\|\|\s*null\s*;/,
      "Expected route completeness logic to prioritize detected total pages as the coverage target.",
    );

    assert.match(
      source,
      /const\s+hasCoverageComplete\s*=\s*coverageTarget\s*!=\s*null[\s\S]*pages\s*>=\s*coverageTarget[\s\S]*:\s*pages\s*>\s*0\s*;/,
      "Expected route completeness logic to use parsed-vs-target page coverage.",
    );

    assert.match(
      source,
      /const\s+isComplete\s*=\s*hasCoverageComplete\s*&&\s*hasCoreIdentity\s*&&\s*hasVerificationConsistency\s*;/,
      "Expected route completeness status to be derived from coverage + identity + verification consistency.",
    );
  }
});
