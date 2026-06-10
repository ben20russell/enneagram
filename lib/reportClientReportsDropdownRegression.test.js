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

test("dashboard keeps dormant report selectors hidden for future re-enable", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /<div class="header-controls"[^>]*style="display:none"[^>]*>/,
    "Expected dashboard header controls to stay hidden while selector code remains available.",
  );

  assert.match(html, /id="reportSelector"/, "Expected hidden example report selector to remain in markup.");
  assert.match(html, /id="clientReportSelector"/, "Expected hidden client report selector to remain in markup.");

  assert.match(
    html,
    /<option value="3" selected>Type 3<\/option>/,
    "Expected Type 3 to be the selected default example report option on initial render.",
  );

  assert.doesNotMatch(
    html,
    /<option value="8" selected>Type 8<\/option>/,
    "Expected Type 8 to no longer be the selected default option.",
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
    /const\s+SHOW_DASHBOARD_REPORT_DROPDOWNS\s*=\s*false\s*;/,
    "Expected dropdown rendering to be globally disabled while preserving selector code.",
  );

  assert.match(
    script,
    /control\.style\.display\s*=\s*SHOW_DASHBOARD_REPORT_DROPDOWNS\s*&&\s*visible\s*\?\s*"flex"\s*:\s*"none";/,
    "Expected selector visibility helpers to keep report dropdowns hidden.",
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

  assert.match(
    script,
    /if\s*\(currentReportViewMode\s*!==\s*"example"\)\s*return;/,
    "Expected example selector sync to avoid overriding client-report mode once selected.",
  );
});
