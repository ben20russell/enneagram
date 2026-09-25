import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");
const start = source.indexOf("async function exportDashboardPdf()");
const end = source.indexOf("\nasync function signOutUser()", start);
assert.ok(start >= 0 && end > start, "The PDF export flow is available");

function exportUi({ state = "idle", onCapture, onSleep } = {}) {
  const button = { disabled: false, textContent: "Export PDF" };
  const classes = new Set();
  const captures = [];
  const downloads = [];
  const alerts = [];
  let cleanupCount = 0;
  let snapshotCount = 0;
  let sleepCount = 0;
  const context = vm.createContext({
    console: { log() {} },
    closeAuthMenu() {},
    getExportPdfButton: () => button,
    buildDashboardExportTitle: () => "Client A Enneagram Dashboard",
    activeReportSelectionState: { selectionKey: "client-report:a", sequence: 1 },
    reportSwitchStatusVersion: 1,
    document: {
      body: {
        dataset: { reportState: state, reportSelectionKey: "client-report:a" },
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      },
    },
    window: {
      jspdf: { jsPDF: class { save(name) { downloads.push(name); } } },
      html2canvas() {},
    },
    profileChart: null,
    sleep: async () => onSleep?.(context, ++sleepCount),
    snapshotChartsForExport() {
      snapshotCount++;
      return () => { cleanupCount++; };
    },
    getDashboardPdfExportTargets: () => [{ id: "sec-overview" }, { id: "sec-growth" }],
    DASHBOARD_EXPORT_PDF_CONFIG: { orientation: "portrait", unit: "pt", format: "letter" },
    captureDashboardExportCanvas: async (node) => {
      captures.push(node.id);
      await onCapture?.(context);
      return { width: 300, height: 600 };
    },
    appendCanvasToPdf() {},
    alert: (message) => alerts.push(message),
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    context, button, classes, captures, downloads, alerts,
    get cleanupCount() { return cleanupCount; },
    get snapshotCount() { return snapshotCount; },
    run: () => context.exportDashboardPdf(),
  };
}

test("a ready report exports all sections and restores the export UI", async () => {
  const ui = exportUi();
  await ui.run();
  assert.deepEqual(ui.captures, ["sec-overview", "sec-growth"]);
  assert.deepEqual(ui.downloads, ["Client A Enneagram Dashboard.pdf"]);
  assert.deepEqual(ui.alerts, []);
  assert.equal(ui.cleanupCount, 1);
  assert.equal(ui.classes.has("exporting-dashboard-pdf"), false);
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.button.textContent, "Export PDF");
});

for (const state of ["loading", "error"]) {
  test(`a report in ${state} state cannot produce a blank PDF`, async () => {
    const ui = exportUi({ state });
    await ui.run();
    assert.deepEqual(ui.captures, []);
    assert.deepEqual(ui.downloads, []);
    assert.equal(ui.snapshotCount, 0);
    assert.equal(ui.alerts.length, 1);
    assert.match(ui.alerts[0], state === "loading" ? /wait|finish loading/i : /retry|refresh/i);
    assert.equal(ui.context.document.body.dataset.reportState, state, "Export does not dismiss loading or errors");
  });
}

test("switching clients during capture cancels download and restores chart snapshots", async () => {
  const ui = exportUi({ onCapture(context) {
    context.activeReportSelectionState = { selectionKey: "client-report:b", sequence: 2 };
    context.document.body.dataset.reportSelectionKey = "client-report:b";
    context.document.body.dataset.reportState = "loading";
    context.reportSwitchStatusVersion++;
  } });
  await ui.run();
  assert.deepEqual(ui.captures, ["sec-overview"]);
  assert.deepEqual(ui.downloads, []);
  assert.equal(ui.cleanupCount, 1);
  assert.equal(ui.classes.has("exporting-dashboard-pdf"), false);
  assert.match(ui.alerts[0], /report.*changed|selected report/i);
  assert.equal(ui.context.document.body.dataset.reportState, "loading");
});

test("a same-report refresh that completes during capture also cancels download", async () => {
  const ui = exportUi({ onCapture(context) {
    // The report can already be idle again by the time capture settles.
    context.reportSwitchStatusVersion += 2;
  } });
  await ui.run();
  assert.deepEqual(ui.captures, ["sec-overview"]);
  assert.deepEqual(ui.downloads, []);
  assert.equal(ui.cleanupCount, 1);
  assert.equal(ui.context.document.body.dataset.reportState, "idle");
});

test("loading that starts during export preparation prevents any capture", async () => {
  const ui = exportUi({ onSleep(context, count) {
    if (count === 1) {
      context.document.body.dataset.reportState = "loading";
      context.reportSwitchStatusVersion++;
    }
  } });
  await ui.run();
  assert.deepEqual(ui.captures, []);
  assert.deepEqual(ui.downloads, []);
  assert.equal(ui.classes.has("exporting-dashboard-pdf"), false);
  assert.equal(ui.context.document.body.dataset.reportState, "loading");
});
