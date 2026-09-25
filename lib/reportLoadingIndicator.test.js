import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");
function loadFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `Missing ${name}`);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/\n(?:async )?function /);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

function component() {
  const node = () => ({ dataset: {}, hidden: true, inert: false, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; } });
  const status = node();
  const content = node();
  const indicator = node();
  const grid = node();
  const frames = [];
  const context = vm.createContext({
    console: { log() {} },
    activeReportSelectionState: { selectionKey: "client-report:a", clientReportId: "a", reportId: "a" },
    reportSwitchStatusVersion: 0,
    getReportSwitchStatusNode: () => status,
    document: {
      body: node(),
      getElementById: (id) => ({ reportContent: content, reportLoadingIndicator: indicator }[id]),
      querySelector: () => grid,
    },
    requestAnimationFrame: (callback) => frames.push(callback),
  });
  vm.runInContext(loadFunction("setReportSwitchStatus"), context);
  return { context, status, content, indicator, grid, frames,
    paint() { frames.splice(0).forEach((callback) => callback()); },
    set: (value) => context.setReportSwitchStatus(value),
  };
}

test("loading shows a buffering indicator and makes the previous report unavailable until ready", () => {
  const ui = component();
  ui.set({ state: "loading", message: "Loading selected client report..." });
  assert.equal(ui.indicator.hidden, false);
  assert.equal(ui.content.attributes["aria-busy"], "true");
  assert.equal(ui.grid.inert, true);
  assert.equal(ui.context.document.body.dataset.reportState, "loading");
  ui.set({ state: "idle" });
  ui.paint();
  assert.equal(ui.indicator.hidden, false, "The loading icon gets a painted frame even for cached reports");
  ui.paint();
  assert.equal(ui.indicator.hidden, true);
  assert.equal(ui.content.attributes["aria-busy"], "false");
  assert.equal(ui.grid.inert, false);
});

test("a superseded completion cannot dismiss the next report's spinner", () => {
  const ui = component();
  ui.set({ state: "loading" });
  ui.set({ state: "idle" });
  ui.context.activeReportSelectionState.selectionKey = "client-report:b";
  ui.set({ state: "loading", selectionKey: "client-report:b" });
  ui.paint();
  ui.paint();
  ui.set({ state: "idle", selectionKey: "client-report:a" });
  ui.set({ state: "error", selectionKey: "client-report:a" });
  ui.paint();
  ui.paint();
  assert.equal(ui.status.dataset.state, "loading");
  assert.equal(ui.status.dataset.selectionKey, "client-report:b");
  assert.equal(ui.indicator.hidden, false);
});

test("a same-report refresh supersedes an already scheduled completion", () => {
  const ui = component();
  ui.set({ state: "loading" });
  ui.set({ state: "idle" });
  ui.set({ state: "loading", reason: "refresh" });
  ui.paint();
  ui.paint();
  assert.equal(ui.indicator.hidden, false);
  assert.equal(ui.status.dataset.reason, "refresh");
});

test("errors stop buffering while keeping partial content unavailable", () => {
  const ui = component();
  ui.set({ state: "loading" });
  ui.set({ state: "idle" });
  ui.set({ state: "error", message: "Please retry loading your report." });
  ui.paint();
  ui.paint();
  assert.equal(ui.indicator.hidden, true);
  assert.equal(ui.content.attributes["aria-busy"], "false");
  assert.equal(ui.grid.inert, true);
  assert.equal(ui.status.dataset.state, "error");
});

test("manual refresh does not clear loading while its ingestion is still pending", async () => {
  const ui = component();
  Object.assign(ui.context, {
    clientReportManualRefreshInFlight: false,
    countAssignedPdfFallbackMarkers: () => 0,
    currentReportViewMode: "client-report", currentClientReportId: "a", assignedReportIngested: true,
    getClientReportSelector: () => ({ value: "a" }),
    setClientReportRefreshButtonLoadingState() {}, invalidateAssignedReportIngestion() {},
    refreshReportActiveUi: async () => {},
  });
  vm.runInContext(loadFunction("onClientReportRefreshClick"), ui.context);
  await ui.context.onClientReportRefreshClick();
  ui.paint();
  ui.paint();
  assert.equal(ui.status.dataset.state, "loading", "Only the report renderer may finish pending hydration");
});

test("a stale ingestion failure cannot replace the current report's loading state", async () => {
  let errorCount = 0;
  const context = vm.createContext({
    console: { log() {} }, assignedReportIngested: false, activeAssignedIngestionToken: 0,
    currentReportViewMode: "client-report", currentClientReportId: "a",
    activeReportSelectionState: { exampleType: "3", selectionKey: "client-report:a" },
    setActiveReportSelectionState() {}, setReportSwitchStatus() {}, hideReportRenderBoundary() {},
    applyFallbackAssignedReportFromServerData() {},
    handleCriticalReportRenderError() { errorCount++; },
  });
  vm.runInContext(loadFunction("ingestAssignedReportIntoDashboard"), context);
  await context.ingestAssignedReportIntoDashboard({
    id: "a",
    get ingestedDashboardContext() {
      context.activeAssignedIngestionToken++;
      throw new Error("Superseded report failed");
    },
  });
  assert.equal(errorCount, 0);
});
