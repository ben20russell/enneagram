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

test("client report switch includes a refresh button to the right of the selector", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="clientReportSwitchControl"[\s\S]*id="clientReportSelector"[\s\S]*id="clientReportRefreshButton"/,
    "Expected client report refresh button to render after the client report selector in the same control row.",
  );

  assert.match(
    html,
    /id="clientReportRefreshButton"[^>]*data-testid="client-report-refresh-button"/,
    "Expected client report refresh button to include a stable test id.",
  );
});

test("client report refresh control exposes a visible refresh icon in markup", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="clientReportRefreshButton"[\s\S]*?<svg[\s\S]*?<path[\s\S]*?<path/s,
    "Expected client report refresh button to include inline SVG icon markup.",
  );
});

test("client report refresh handler invalidates stale ingestion and re-fetches report-active payload", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+setupClientReportRefreshHandler\s*\(/,
    "Expected dashboard script to bind a dedicated handler for the client report refresh button.",
  );

  assert.match(
    script,
    /function\s+onClientReportRefreshClick\s*\(/,
    "Expected dashboard script to expose a click handler for manual client-report rehydration.",
  );

  assert.match(
    script,
    /invalidateAssignedReportIngestion\(\s*"manual-client-report-refresh"[\s\S]*?refreshReportActiveUi\(\s*\)/s,
    "Expected manual refresh click to invalidate stale ingestion and rehydrate via report-active refresh.",
  );

  assert.match(
    script,
    /setupClientReportRefreshHandler\(\)/,
    "Expected dashboard bootstrap flow to initialize the client report refresh handler.",
  );
});

test("client report refresh button visibility is restricted to admins", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /function\s+setClientReportRefreshButtonVisible\s*\(visible\)\s*\{[\s\S]*?clientReportRefreshButton\.style\.display\s*=\s*visible\s*\?\s*"inline-flex"\s*:\s*"none";[\s\S]*?\}/,
    "Expected dashboard script to centralize refresh button visibility via inline display styles.",
  );

  assert.match(
    script,
    /setClientReportRefreshButtonVisible\(\s*isAdmin\s*&&\s*adminClientReports\.length\s*>\s*0\s*\)/,
    "Expected client report refresh button visibility to require admin access.",
  );
});
