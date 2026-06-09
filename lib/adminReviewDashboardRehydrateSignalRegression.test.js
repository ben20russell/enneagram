import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");
const reportScriptPath = path.join(process.cwd(), "public", "report.js");

function readPanel() {
  return readFileSync(panelPath, "utf8");
}

function readReportScript() {
  return readFileSync(reportScriptPath, "utf8");
}

test("admin review force re-save emits dashboard rehydrate signals for open dashboard tabs", () => {
  const source = readPanel();

  assert.match(
    source,
    /const DASHBOARD_REHYDRATE_STORAGE_KEY = "admin-review:dashboard-rehydrate";/,
    "Expected admin review panel to define a stable storage key for dashboard rehydrate events.",
  );

  assert.match(
    source,
    /const DASHBOARD_REHYDRATE_CHANNEL = "admin-review-dashboard-sync";/,
    "Expected admin review panel to define a BroadcastChannel name for dashboard rehydrate events.",
  );

  assert.match(
    source,
    /function emitDashboardRehydrateSignal\([\s\S]*?\)\s*\{[\s\S]*?localStorage\.setItem\([\s\S]*?DASHBOARD_REHYDRATE_STORAGE_KEY[\s\S]*?\)[\s\S]*?\}/,
    "Expected admin review panel to persist a dashboard rehydrate signal in localStorage.",
  );

  assert.match(
    source,
    /new BroadcastChannel\(DASHBOARD_REHYDRATE_CHANNEL\)/,
    "Expected admin review panel to broadcast dashboard rehydrate messages to open tabs.",
  );

  assert.match(
    source,
    /handleForceResaveGradedReports[\s\S]*?if\s*\(!res\.ok\)[\s\S]*?setStatus\([\s\S]*Re-save complete[\s\S]*emitDashboardRehydrateSignal\(\s*\{[\s\S]*?updatedCount[\s\S]*?\}\s*\)/s,
    "Expected force re-save handler to emit dashboard rehydrate signal after a successful bulk re-save.",
  );
});

test("dashboard listens for admin-review rehydrate signals and refreshes report-active payload", () => {
  const source = readReportScript();

  assert.match(
    source,
    /const DASHBOARD_REHYDRATE_STORAGE_KEY = "admin-review:dashboard-rehydrate";/,
    "Expected dashboard script to use the same rehydrate storage key emitted by admin review.",
  );

  assert.match(
    source,
    /const DASHBOARD_REHYDRATE_CHANNEL = "admin-review-dashboard-sync";/,
    "Expected dashboard script to use the same rehydrate BroadcastChannel name emitted by admin review.",
  );

  assert.match(
    source,
    /function handleDashboardRehydrateSignal\([\s\S]*?\)\s*\{[\s\S]*?refreshReportActiveUi\(\);[\s\S]*?\}/,
    "Expected dashboard script to re-fetch report-active data when a rehydrate signal is received.",
  );

  assert.match(
    source,
    /window\.addEventListener\("storage",[\s\S]*?event\.key\s*!==\s*DASHBOARD_REHYDRATE_STORAGE_KEY[\s\S]*?handleDashboardRehydrateSignal/s,
    "Expected dashboard script to process cross-tab storage events for dashboard rehydrate signals.",
  );

  assert.match(
    source,
    /new BroadcastChannel\(DASHBOARD_REHYDRATE_CHANNEL\)[\s\S]*?addEventListener\("message",[\s\S]*?handleDashboardRehydrateSignal/s,
    "Expected dashboard script to process BroadcastChannel messages for dashboard rehydrate signals.",
  );
});
