import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("assigned report ingestion reads parser verification payload and hydration fallbacks", () => {
  const source = read(reportScriptPath);

  assert.match(
    source,
    /parseDiagnostics\?\.verification/,
    "Expected assigned-report ingestion flow to read parser verification metadata",
  );

  assert.match(
    source,
    /verificationResolvedFields\?\.primaryType/,
    "Expected hydration flow to fallback to verification-resolved primary type when needed",
  );

  assert.match(
    source,
    /verificationResolvedFields\?\.instinctualVariant/,
    "Expected hydration flow to fallback to verification-resolved instinct variant when needed",
  );

  assert.match(
    source,
    /verificationResolvedFields\?\.integrationLevel/,
    "Expected hydration flow to fallback to verification-resolved integration level when needed",
  );

  assert.match(
    source,
    /let\s+detectedType\s*=\s*normalizeDetectedTypeCandidate\(\s*verificationResolvedFields\?\.primaryType\s*\)\s*\|\|\s*normalizeDetectedTypeCandidate\(\s*parsedProfile\?\.primaryType\s*\)\s*\|\|\s*normalizeDetectedTypeCandidate\(\s*serverContext\?\.detectedType\s*\)/,
    "Expected hydration flow to prioritize verification and parsed primary type over dashboard context fallback.",
  );

  assert.match(
    source,
    /let\s+instinct\s*=\s*instinctValueToLabel\(\s*normalizeAssignedIdentityValue\(\s*verificationResolvedFields\?\.instinctualVariant\s*\)\s*\)\s*\|\|\s*instinctValueToLabel\(\s*normalizeAssignedIdentityValue\(\s*parsedProfile\?\.instinctualVariant\s*\)\s*\)\s*\|\|\s*instinctValueToLabel\(/,
    "Expected hydration flow to prioritize verification and parsed instinct values over dashboard context placeholders.",
  );

  assert.match(
    source,
    /let\s+integrationLevel\s*=\s*normalizeAssignedIdentityValue\(\s*verificationResolvedFields\?\.integrationLevel\s*\)\s*\|\|\s*normalizeAssignedIdentityValue\(\s*parsedProfile\?\.integrationLevel\s*\|\|\s*parsedProfile\?\.integration\s*\)\s*\|\|\s*normalizeAssignedIdentityValue\(\s*serverContext\?\.integrationLevel\s*\|\|\s*serverContext\?\.integration\s*\)/,
    "Expected hydration flow to prioritize verification and parsed integration level over dashboard context fallback.",
  );
});

test("report diagnostics include Python cross-check verification summary", () => {
  const source = read(reportScriptPath);

  assert.match(
    source,
    /Python verification:/,
    "Expected data quality diagnostics summary to include Python cross-check status",
  );

  assert.match(
    source,
    /pythonMismatches/,
    "Expected diagnostics verification snapshot to expose Python mismatch count",
  );
});
