import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");
const reportHtmlPath = path.join(repoRoot, "public", "report.html");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("dashboard script keeps a canonical active report selection state for switch consistency", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /let\s+activeReportSelectionState\s*=\s*\{/,
    "Expected a canonical active report selection object to exist.",
  );

  assert.match(
    script,
    /function\s+buildReportSelectionKey\s*\(/,
    "Expected selection-key builder for deterministic report identity.",
  );

  assert.match(
    script,
    /function\s+setActiveReportSelectionState\s*\(/,
    "Expected a single setter to mutate active report selection state.",
  );
});

test("report-active fetch flow cancels stale in-flight requests and uses fetch signals", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /let\s+activeReportActiveRequestToken\s*=\s*0\s*;/,
    "Expected token tracking for active report-active fetch requests.",
  );

  assert.match(
    script,
    /let\s+activeReportActiveAbortController\s*=\s*null\s*;/,
    "Expected AbortController tracking for report-active request cancellation.",
  );

  assert.match(
    script,
    /activeReportActiveAbortController\.abort\(/,
    "Expected report-active refresh to abort previous in-flight request before starting another.",
  );

  assert.match(
    script,
    /fetch\(\s*"\/api\/report-active"[\s\S]*?signal:\s*requestAbortController\.signal/s,
    "Expected report-active request to pass AbortController signal into fetch.",
  );
});

test("report switch path validates report-active payload shape before hydration", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /function\s+validateReportActivePayloadShape\s*\(/,
    "Expected runtime validator for report-active payload shape.",
  );

  assert.match(
    script,
    /const\s+validatedReportActivePayload\s*=\s*validateReportActivePayloadShape\(/,
    "Expected refresh flow to apply report-active payload validation before state updates.",
  );
});

test("render flow resets report-scoped UI state whenever selection key changes", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /function\s+resetReportScopedUiState\s*\(/,
    "Expected report-scoped UI reset helper for deterministic switching.",
  );

  assert.match(
    script,
    /resetReportScopedUiState\(\s*activeReportSelectionState\.selectionKey\s*\)/,
    "Expected report apply flow to reset report-scoped UI state using active selection key.",
  );
});

test("dashboard markup includes a report render error boundary with recovery actions", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="reportRenderErrorBoundary"/,
    "Expected global report render error boundary container in dashboard markup.",
  );

  assert.match(
    html,
    /id="reportRenderRetryButton"/,
    "Expected error boundary retry action button in dashboard markup.",
  );

  assert.match(
    html,
    /id="reportRenderRefreshButton"/,
    "Expected error boundary refresh action button in dashboard markup.",
  );
});

test("report render flow surfaces critical render failures via error boundary handler", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /function\s+showReportRenderBoundary\s*\(/,
    "Expected helper to display user-facing render error boundary.",
  );

  assert.match(
    script,
    /function\s+handleCriticalReportRenderError\s*\(/,
    "Expected centralized critical render error handler for recovery messaging.",
  );

  assert.match(
    script,
    /renderReportFromState\s*\([\s\S]*?try\s*\{[\s\S]*?\}\s*catch\s*\(\s*error\s*\)\s*\{[\s\S]*?handleCriticalReportRenderError\(/s,
    "Expected renderReportFromState to route critical failures through boundary error handling.",
  );
});

test("report switching emits diagnostics for selection state and major section payloads", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /\[report-switch\]\s*active selection updated/,
    "Expected report switch flow to log active selection state updates.",
  );

  assert.match(
    script,
    /\[report-render\]\s*major section payloads/,
    "Expected render flow to log major section payload payload snapshots after each report switch.",
  );
});
