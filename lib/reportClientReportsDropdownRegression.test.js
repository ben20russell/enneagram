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

test("dashboard keeps client reports selector available in header controls", () => {
  const html = read(reportHtmlPath);

  assert.doesNotMatch(html, /<div class="header-controls"[^>]*style="display:none"[^>]*>/);

  assert.match(html, /id="reportSwitchControl"/, "Expected example report switch container to remain in markup.");
  assert.match(html, /id="clientReportSwitchControl"/, "Expected client report switch container to remain in markup.");
  assert.match(html, /id="clientReportSelector"/, "Expected client report selector to remain in markup.");

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

test("dashboard script enables client reports selector visibility while keeping example selector dormant", () => {
  const script = read(reportJsPath);

  assert.match(script, /function\s+populateClientReportSelector\s*\(/, "Expected selector population helper.");
  assert.match(script, /Array\.isArray\(data\?\.adminClientReports\)\s*\?\s*data\.adminClientReports\s*:\s*\[\s*\]/);

  assert.match(
    script,
    /const\s+SHOW_EXAMPLE_REPORT_DROPDOWN\s*=\s*false\s*;/,
    "Expected example selector to remain disabled.",
  );

  assert.match(
    script,
    /const\s+SHOW_CLIENT_REPORT_DROPDOWN\s*=\s*true\s*;/,
    "Expected client reports selector to be enabled.",
  );

  assert.match(script, /function\s+isLocalhostRuntime\s*\(/, "Expected localhost runtime helper.");

  assert.match(script, /setReportSwitchVisible[\s\S]*SHOW_EXAMPLE_REPORT_DROPDOWN\s*&&\s*visible/);
  assert.match(script, /setClientReportSwitchVisible[\s\S]*SHOW_CLIENT_REPORT_DROPDOWN\s*&&\s*visible/);

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

test("dashboard auto-loads the client report associated with the signed-in email", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+findClientReportForSignedInUser\s*\(/,
    "Expected helper to match a client report row to the signed-in user email",
  );

  assert.match(
    script,
    /normalizeEmail\(\s*signedInUserEmail\s*\)/,
    "Expected helper to normalize the signed-in email before matching",
  );

  assert.match(
    script,
    /const\s+emailMatchedClientReport\s*=\s*findClientReportForSignedInUser\(\s*adminClientReports\s*,\s*currentSignedInUser\?\.email\s*,?\s*\)/,
    "Expected refresh flow to resolve a client report mapped to the active login email",
  );

  assert.match(
    script,
    /if\s*\(emailMatchedClientReport\?\.id\)\s*\{[\s\S]*currentReportViewMode\s*=\s*"client-report"[\s\S]*ingestAssignedReportIntoDashboard\(\s*emailMatchedClientReport\s*\)/,
    "Expected matching client report to hydrate dashboard automatically in client-report mode",
  );
});
