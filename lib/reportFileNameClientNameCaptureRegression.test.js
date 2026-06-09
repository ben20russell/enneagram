import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const adminImportRoutePath = path.join(repoRoot, "app", "api", "admin-import", "route.js");
const adminImportFinalizeLiteRoutePath = path.join(repoRoot, "app", "api", "admin-import", "finalize-lite", "route.js");
const adminImportReparseRoutePath = path.join(repoRoot, "app", "api", "admin-import", "reparse", "route.js");
const adminImportApplyParsedRoutePath = path.join(repoRoot, "app", "api", "admin-import", "apply-parsed", "route.js");
const adminReviewBulkResaveRoutePath = path.join(repoRoot, "app", "api", "admin-review", "resave-graded", "route.js");
const reportActiveRoutePath = path.join(repoRoot, "app", "api", "report-active", "route.js");
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return readFileSync(filePath, "utf8");
}

test("admin import routes derive client name from PDF file name and persist it in dashboard context", () => {
  const adminImportSource = read(adminImportRoutePath);
  const finalizeLiteSource = read(adminImportFinalizeLiteRoutePath);
  const reparseSource = read(adminImportReparseRoutePath);
  const applyParsedSource = read(adminImportApplyParsedRoutePath);

  assert.match(
    adminImportSource,
    /extractClientNameFromReportFileName/,
    "Expected admin-import route to import the filename client-name resolver.",
  );
  assert.match(
    adminImportSource,
    /dashboardContext:\s*\{[\s\S]*?clientName:/s,
    "Expected admin-import route to persist filename-derived clientName in dashboardContext.",
  );
  assert.match(
    finalizeLiteSource,
    /dashboardContext:\s*\{[\s\S]*?clientName:/s,
    "Expected finalize-lite route to capture filename-derived clientName in metadata-only imports.",
  );
  assert.match(
    reparseSource,
    /dashboardContext:\s*\{[\s\S]*?clientName:/s,
    "Expected reparse route to keep dashboardContext.clientName synchronized.",
  );
  assert.match(
    applyParsedSource,
    /dashboardContext:\s*\{[\s\S]*?clientName:/s,
    "Expected apply-parsed route to keep dashboardContext.clientName synchronized.",
  );
});

test("bulk re-save and report hydration paths preserve filename-derived client names", () => {
  const bulkResaveSource = read(adminReviewBulkResaveRoutePath);
  const reportActiveSource = read(reportActiveRoutePath);
  const reportScriptSource = read(reportScriptPath);

  assert.match(
    bulkResaveSource,
    /dashboardContext:\s*\{[\s\S]*?clientName:/s,
    "Expected bulk re-save path to backfill dashboardContext.clientName for existing graded reports.",
  );
  assert.match(
    reportActiveSource,
    /extractClientNameFromReportFileName/,
    "Expected report-active route to derive client display name from report file names.",
  );
  assert.match(
    reportScriptSource,
    /clientName:\s*parsedProfile\?\.clientName\s*\|\|\s*normalizeAssignedIdentityValue\(serverContext\?\.clientName\)\s*\|\|\s*null/,
    "Expected dashboard ingestion to fall back to serverContext.clientName when parsedProfile.clientName is missing.",
  );
});
