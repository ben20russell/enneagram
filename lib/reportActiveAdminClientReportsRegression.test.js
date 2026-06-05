import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportActiveRoutePath = path.join(repoRoot, "app", "api", "report-active", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("report-active API computes admin access from authenticated user email", () => {
  const routeSource = read(reportActiveRoutePath);

  assert.match(
    routeSource,
    /hasAdminAccess\s*\(\s*normalizeEmail\s*\(\s*userEmail\s*\)\s*\)/,
    "Expected report-active route to derive admin privileges from normalized authenticated user email",
  );
});

test("report-active API allows localhost preview access to client reports", () => {
  const routeSource = read(reportActiveRoutePath);

  assert.match(
    routeSource,
    /function\s+isLocalhostPreviewRequest\s*\(\s*request\s*\)/,
    "Expected report-active route to define localhost preview request detection",
  );

  assert.match(
    routeSource,
    /const\s+canAccessAdminClientReports\s*=\s*isAdmin\s*\|\|\s*isLocalhostPreview\s*;/,
    "Expected report-active route to allow localhost preview access alongside admin access",
  );

  assert.match(
    routeSource,
    /adminClientReports:\s*canAccessAdminClientReports\s*\?\s*adminClientReports\s*:\s*\[\s*\]/,
    "Expected report-active success response to expose client reports to admin or localhost preview users",
  );
});

test("report-active API scopes client report listing to uploaded admin-import reports", () => {
  const routeSource = read(reportActiveRoutePath);

  assert.match(
    routeSource,
    /\.eq\(\s*"source"\s*,\s*"admin-import"\s*\)/,
    "Expected report-active route to limit client report listing to uploaded admin-import reports",
  );
});

test("report-active API requires Python cross-check consistency for assigned report readiness", () => {
  const routeSource = read(reportActiveRoutePath);

  assert.match(
    routeSource,
    /verificationCriticalMismatchCount\s*=\s*Number\s*\(\s*parseDiagnostics\?\.verification\?\.criticalMismatchCount\s*\?\?\s*0\s*\)/,
    "Expected report-active ingestion state to read Python cross-check critical mismatch count",
  );

  assert.match(
    routeSource,
    /isComplete\s*=\s*status\s*===\s*"ready"[\s\S]*hasVerificationConsistency/,
    "Expected assigned report readiness to require Python cross-check consistency",
  );
});

test("report-active API no longer hard-gates assigned readiness on fully populated chart scores", () => {
  const routeSource = read(reportActiveRoutePath);

  assert.doesNotMatch(
    routeSource,
    /isComplete\s*=\s*status\s*===\s*"ready"[\s\S]*hasAllChartScores/,
    "Expected assigned report readiness to avoid hard dependency on full chart-score population.",
  );

  assert.match(
    routeSource,
    /const\s+hasCoreIdentity\s*=\s*Boolean\(\s*parsedProfile\?\.primaryType\s*\|\|\s*parsedProfile\?\.typeName\s*\)/,
    "Expected assigned report readiness checks to include core identity presence.",
  );
});
