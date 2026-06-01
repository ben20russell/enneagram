import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportHtmlPath = path.join(repoRoot, "public", "report.html");
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("dashboard renders a separate Client Reports dropdown control", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="clientReportSwitchControl"/,
    "Expected a dedicated dropdown control container for Client Reports",
  );

  assert.match(
    html,
    /for="clientReportSelector">Client Reports</,
    "Expected Client Reports label to target the dedicated client report selector",
  );

  assert.match(
    html,
    /id="clientReportSelector"/,
    "Expected dedicated select element for client reports",
  );
});

test("dashboard script populates Client Reports dropdown from report-active payload", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+populateClientReportSelector\s*\(/,
    "Expected script helper to populate Client Reports selector options",
  );

  assert.match(
    script,
    /Array\.isArray\(data\?\.adminClientReports\)\s*\?\s*data\.adminClientReports\s*:\s*\[\s*\]/,
    "Expected report-active payload to drive Client Reports list population",
  );

  assert.match(
    script,
    /function\s+isLocalhostRuntime\s*\(/,
    "Expected localhost runtime helper for local preview visibility",
  );

  assert.match(
    script,
    /setClientReportSwitchVisible\(\s*\(\s*isAdmin\s*\|\|\s*isLocalhostClientPreview\s*\)\s*&&\s*adminClientReports\.length\s*>\s*0\s*\)/,
    "Expected Client Reports selector visibility to support admins and localhost preview with available client report data",
  );
});

test("client report selection applies uploaded report payload into dashboard", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+onClientReportSelectorChange\s*\(/,
    "Expected dedicated change handler for Client Reports selector",
  );

  assert.match(
    script,
    /currentReportViewMode\s*=\s*"client-report"/,
    "Expected selecting a client report to switch dashboard mode to client-report",
  );

  assert.match(
    script,
    /ingestAssignedReportIntoDashboard\(\s*selectedClientReport\s*\)/,
    "Expected selected client report payload to hydrate dashboard content",
  );
});
