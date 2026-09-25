import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");
const start = source.indexOf("async function hydrateDashboardNarrativesWithLlmCleanup(");
const end = source.indexOf("\nfunction extractCorePatternSectionByAnchors(", start);
assert.ok(start >= 0 && end > start, "The dashboard cleanup helper must be available for concurrency testing.");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function cleanupHarness() {
  const requests = [];
  const timers = new Set();
  const cache = new Map();
  const logs = [];
  const context = vm.createContext({
    console: { log: (...args) => logs.push(args) },
    AbortController,
    activeAssignedIngestionToken: 1,
    activeDashboardCleanupAbortController: null,
    DASHBOARD_COPY_HYDRATION_CACHE: cache,
    DASHBOARD_COPY_HYDRATION_CLEANUP_ROUTE: "/api/report-hydration/dashboard-copy/cleanup",
    DASHBOARD_COPY_HYDRATION_LLM_TIMEOUT_MS: 300000,
    normalizeDashboardNarrativeCleanupInput: (value) => value,
    shouldRequestDashboardNarrativesCleanup: () => true,
    buildDashboardNarrativesCleanupCacheKey: ({ reportId }) => reportId,
    mergeDashboardNarrativeCleanupPayload: (preferred) => preferred,
    applyDashboardInstinctGoalIsolationGuard: (preferred) => preferred,
    resolveDashboardNarrativeCleanupPayload: (value) => value,
    window: {
      setTimeout: (callback) => { timers.add(callback); return callback; },
      clearTimeout: (timer) => timers.delete(timer),
    },
    fetch: (url, options) => {
      const pending = deferred();
      requests.push({ url, options, ...pending });
      // Deliberately allow resolution after abort, as a response may already be in flight.
      return pending.promise;
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    context, requests, timers, cache, logs,
    run: (ingestionToken, reportId = "same-report") => context.hydrateDashboardNarrativesWithLlmCleanup({
      ingestionToken, reportId, reportFileName: `${reportId}.pdf`, overallStrainSummary: "Original report text",
    }),
  };
}

function successfulResponse(text) {
  return { ok: true, json: async () => ({ overallStrainSummary: text }) };
}

test("an older PDF extraction reaching cleanup cannot abort the currently selected report", async () => {
  const ui = cleanupHarness();
  ui.context.activeAssignedIngestionToken = 3;
  const current = ui.run(3);
  const activeController = ui.context.activeDashboardCleanupAbortController;
  const older = ui.run(2);
  assert.equal(ui.requests.length, 1, "Stale ingestion must not start another cleanup request.");
  assert.equal(ui.requests[0].options.signal.aborted, false, "The selected report's cleanup must remain active.");
  assert.equal(ui.context.activeDashboardCleanupAbortController, activeController);
  assert.equal((await older).overallStrainSummary, "Original report text");
  ui.requests[0].resolve(successfulResponse("Current cleaned report"));
  assert.equal((await current).overallStrainSummary, "Current cleaned report");
  assert.equal(ui.cache.get("same-report").overallStrainSummary, "Current cleaned report");
  assert.equal(ui.timers.size, 0);
});

test("a new report can cancel old cleanup while an ignored abort cannot overwrite its cache", async () => {
  const ui = cleanupHarness();
  const older = ui.run(1);
  ui.context.activeAssignedIngestionToken = 2;
  const current = ui.run(2);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.equal(ui.requests[1].options.signal.aborted, false);
  ui.requests[1].resolve(successfulResponse("New cleaned report"));
  await current;
  ui.requests[0].resolve(successfulResponse("Stale cleaned report"));
  assert.equal((await older).overallStrainSummary, "Original report text");
  assert.equal(ui.cache.get("same-report").overallStrainSummary, "New cleaned report");
  assert.equal(ui.context.activeDashboardCleanupAbortController, null);
  assert.equal(ui.timers.size, 0);
});

test("an ingestion superseded while reading JSON cannot populate cache or clear the new controller", async () => {
  const ui = cleanupHarness();
  const body = deferred();
  const readingBody = deferred();
  const older = ui.run(1, "older-report");
  ui.requests[0].resolve({ ok: true, json: () => { readingBody.resolve(); return body.promise; } });
  await readingBody.promise;
  ui.context.activeAssignedIngestionToken = 2;
  const current = ui.run(2, "current-report");
  const activeController = ui.context.activeDashboardCleanupAbortController;
  body.resolve({ overallStrainSummary: "Stale report" });
  await older;
  assert.equal(ui.cache.has("older-report"), false);
  assert.equal(ui.context.activeDashboardCleanupAbortController, activeController);
  ui.requests[1].resolve(successfulResponse("Current report"));
  await current;
});

test("a stale HTTP failure cannot cache fallback text over a newer successful cleanup", async () => {
  const ui = cleanupHarness();
  const failureBody = deferred();
  const readingBody = deferred();
  const older = ui.run(1);
  ui.requests[0].resolve({
    ok: false, status: 503, statusText: "Unavailable",
    text: () => { readingBody.resolve(); return failureBody.promise; },
  });
  await readingBody.promise;
  ui.context.activeAssignedIngestionToken = 2;
  const current = ui.run(2);
  ui.requests[1].resolve(successfulResponse("Current report"));
  await current;
  failureBody.resolve("Unavailable");
  await older;
  assert.equal(ui.cache.get("same-report").overallStrainSummary, "Current report");
});

test("a stale network failure cannot cache fallback text over a newer successful cleanup", async () => {
  const ui = cleanupHarness();
  const older = ui.run(1);
  ui.context.activeAssignedIngestionToken = 2;
  const current = ui.run(2);
  ui.requests[1].resolve(successfulResponse("Current report"));
  await current;
  ui.requests[0].reject(new Error("Network failed after report switch"));
  await older;
  assert.equal(ui.cache.get("same-report").overallStrainSummary, "Current report");
});

test("standalone cleanup without an ingestion token still works and respects request ownership", async () => {
  const ui = cleanupHarness();
  const older = ui.run(undefined);
  const current = ui.run(undefined);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  ui.requests[1].resolve(successfulResponse("Current standalone cleanup"));
  await current;
  ui.requests[0].resolve(successfulResponse("Stale standalone cleanup"));
  await older;
  assert.equal(ui.cache.get("same-report").overallStrainSummary, "Current standalone cleanup");
});
