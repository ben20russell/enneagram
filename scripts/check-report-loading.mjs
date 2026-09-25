// Run against npm run dev. Uses existing local reports without changing saved data.
// Install Chromium with npx playwright install chromium if Google Chrome is unavailable.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const baseURL = process.env.REPORT_LOADING_CHECK_URL || "http://127.0.0.1:3000";
const output = process.env.REPORT_LOADING_CHECK_OUTPUT || "/tmp/enneagram-report-loading-check";
const desktopViewport = { width: 1440, height: 1000 };
const mobileViewport = { width: 390, height: 844 };
const timeout = 150000;
mkdirSync(output, { recursive: true });
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});
const context = await browser.newContext({ viewport: desktopViewport });
const page = await context.newPage();
const errors = [];
const snapshots = [];
let report;
page.on("pageerror", (error) => errors.push(error.message));

async function nextPaint() {
  await report.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function waitForReady(id) {
  await report.waitForFunction((clientId) => {
    const selection = getActiveReportSelectionState();
    return selection.selectionKey === `client-report:${clientId}`
      && document.body.dataset.reportSelectionKey === selection.selectionKey
      && document.body.dataset.reportState === "idle"
      && document.getElementById("reportSwitchStatus")?.dataset.state === "idle"
      && document.getElementById("reportLoadingIndicator")?.hidden === true;
  }, id, { timeout });
  await nextPaint();
  assert.equal(await report.locator("#reportContent").getAttribute("aria-busy"), "false", "Ready report clears aria-busy");
  assert.equal(await report.locator(".body-grid").evaluate((el) => el.inert), false, "Ready content becomes interactive");
  assert.equal(await report.locator("#reportLoadingIndicator").isVisible(), false, "Buffering icon disappears after render");
  assert.equal(await report.locator("#headerSubtitle").isVisible(), true, "Ready report reveals its heading");
  assert.equal(await report.locator(".sec.active").isVisible(), true, "Ready report reveals its active section");
  assert.equal(await report.locator("#reportRenderErrorBoundary").getAttribute("data-visible"), "false", "No render error boundary");
}

async function armCleanupGate(id) {
  await report.evaluate((clientId) => {
    const state = window.__reportLoadingCheck;
    const previousGate = state.gates[clientId];
    if (previousGate && !previousGate.released) throw new Error("Cannot replace a pending cleanup gate");
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    state.gates[clientId] = { promise, release, released: false, calls: [] };
  }, id);
}

async function waitForCleanupGate(id) {
  await report.waitForFunction((clientId) => window.__reportLoadingCheck.gates[clientId]?.calls
    .some((call) => call.phase === "waiting"), id, { timeout });
}

async function releaseCleanupGate(id) {
  await report.evaluate((clientId) => {
    const gate = window.__reportLoadingCheck.gates[clientId];
    gate.released = true;
    gate.release();
  }, id);
}

async function assertBuffering(id) {
  await nextPaint();
  assert.equal(await report.locator("#clientReportSelector").inputValue(), id, "Selector reflects the requested client immediately");
  assert.equal(await report.locator("#clientReportSelector").isEnabled(), true, "Client selector remains usable while buffering");
  assert.equal(await report.locator("#reportSelector").isEnabled(), true, "Example selector remains enabled");
  assert.equal(await report.locator("#reportLoadingIndicator").isVisible(), true, "A visible buffering icon spans asynchronous cleanup");
  assert.equal(await report.locator("#reportLoadingIndicator").evaluate((el) => el.hidden), false);
  assert.equal(await report.locator("#reportSwitchStatus").getAttribute("data-state"), "loading");
  assert.equal(await report.locator("#reportContent").getAttribute("aria-busy"), "true", "Report content announces its loading state");
  assert.equal(await report.locator(".body-grid").evaluate((el) => el.inert), true, "Stale report content cannot be activated");
  assert.equal(await report.locator("#headerSubtitle").isVisible(), false, "The old client heading is hidden");
  for (const section of await report.locator(".sec").all()) {
    assert.equal(await section.isVisible(), false, `Old report text is hidden: ${await section.getAttribute("id")}`);
  }
  assert.equal(await report.locator("#reflectionWidget").isVisible(), false, "Old reflection content is hidden");
  const state = await report.evaluate(() => ({
    selectedKey: getActiveReportSelectionState().selectionKey,
    reportState: document.body.dataset.reportState,
    error: document.getElementById("reportRenderErrorBoundary")?.dataset.visible,
  }));
  assert.equal(state.selectedKey, `client-report:${id}`);
  assert.equal(state.reportState, "loading");
  assert.equal(state.error, "false");
}

async function snapshotReport() {
  return report.evaluate(() => {
    const sections = [...document.querySelectorAll(".sec:not(#sec-focus):not(#sec-test)")];
    const charts = typeof Chart === "undefined" ? [] : Object.values(Chart.instances || {}).map((chart) => ({
      id: chart.canvas.id,
      labels: chart.data.labels,
      data: chart.data.datasets.map((dataset) => dataset.data),
    }));
    return {
      key: document.body.dataset.reportSelectionKey,
      type: String(REPORT.typeNumber),
      heading: document.getElementById("headerSubtitle").textContent,
      clientName: document.getElementById("clientNameValue").textContent,
      sections: sections.map((el) => ({
        id: el.id,
        key: el.dataset.reportSelectionKey,
        available: el.style.display !== "none",
        text: el.style.display !== "none" ? el.textContent : null,
      })),
      bindings: Object.fromEntries(sections.flatMap((section) => section.style.display === "none" ? []
        : [...section.querySelectorAll("[id]")].map((el) => [el.id, el.innerHTML]))),
      visuals: ["profileWheel", "centerExpressionWheel", "strainBreakdownRows"].map((id) => ({
        id,
        available: document.getElementById(id)?.closest(".sec")?.style.display !== "none",
        html: document.getElementById(id)?.innerHTML,
      })),
      charts,
      reflectionType: document.getElementById("refTypeTag")?.textContent,
      chartSources: {
        profile: REPORT.profile,
        centers: REPORT.centerScoresRaw,
        instincts: REPORT.instinctScoresRaw,
        strain: REPORT.strainScoresRaw,
        interactions: REPORT.interactionScores,
      },
    };
  });
}

function assertFreshBindings(snapshot, id) {
  assert.equal(snapshot.key, `client-report:${id}`);
  assert.ok(snapshot.heading.includes(`Type ${snapshot.type}`), "Header uses the rendered report type");
  assert.ok(snapshot.reflectionType.includes(`Type ${snapshot.type}`), "Reflections use the rendered report type");
  for (const section of snapshot.sections) assert.equal(section.key, snapshot.key, `Fresh report binding: ${section.id}`);
}

function assertRestoredReport(actual, expected, label) {
  assert.deepEqual(actual.sections, expected.sections, `${label}: all section text is restored`);
  assert.deepEqual(actual.bindings, expected.bindings, `${label}: scores, labels, insights, and recommendations are restored`);
  assert.deepEqual(actual.visuals, expected.visuals, `${label}: chart markup is restored`);
  assert.deepEqual(actual.charts, expected.charts, `${label}: chart datasets and labels are restored`);
  assert.deepEqual(actual.chartSources, expected.chartSources, `${label}: chart source data is restored`);
  assert.equal(actual.heading, expected.heading, `${label}: header is restored`);
  assert.equal(actual.clientName, expected.clientName, `${label}: client identity is restored`);
  assert.equal(actual.reflectionType, expected.reflectionType, `${label}: reflection identity is restored`);
}

try {
  await page.goto(baseURL);
  const frameElement = await page.waitForSelector('iframe[data-testid="report-frame"]');
  report = await frameElement.contentFrame();
  assert.ok(report, "The main page embeds the report");
  await report.waitForFunction(() => document.querySelectorAll("#clientReportSelector option[value]:not([value=''])").length >= 2, null, { timeout });
  await report.waitForFunction(() => document.getElementById("reportSwitchStatus")?.dataset.state === "idle", null, { timeout });

  // Prefer different client types, with full reports, to exercise every report section.
  const clients = await report.evaluate(() => [...document.querySelectorAll("#clientReportSelector option")]
    .filter((option) => option.value)
    .map((option) => {
      const data = getClientReportById(option.value);
      const profile = data?.ingestedParsedProfile || {};
      const context = data?.ingestedDashboardContext || {};
      return {
        id: option.value,
        type: String(profile.primaryType || context.detectedType || ""),
        pro: String(profile.reportType || context.reportType || data?.reportType || "").toUpperCase() === "PRO",
      };
    }));
  const preferredClients = clients.filter((client) => client.pro).length >= 2 ? clients.filter((client) => client.pro) : clients;
  const clientA = preferredClients[0].id;
  const clientB = (preferredClients.find((client) => client.id !== clientA && client.type && client.type !== preferredClients[0].type)
    || preferredClients.find((client) => client.id !== clientA)).id;

  // Only hold the browser's cleanup promise; the original hydration still runs unchanged.
  await report.evaluate(() => {
    const original = hydrateDashboardNarrativesWithLlmCleanup;
    const state = { original, gates: Object.create(null) };
    window.__reportLoadingCheck = state;
    hydrateDashboardNarrativesWithLlmCleanup = async function controlledCleanup(payload) {
      const gate = state.gates[String(payload.reportId || "")];
      if (!gate || gate.released) return original(payload);
      const call = { ingestionToken: payload.ingestionToken, phase: "waiting" };
      gate.calls.push(call);
      try {
        await gate.promise;
        call.phase = "cleaning";
        return await original(payload);
      } finally {
        call.phase = "settled";
      }
    };
    showSec("overview");
    scrollTo(0, 0);
  });

  for (const [index, id] of [clientA, clientB, clientA].entries()) {
    await armCleanupGate(id);
    await report.locator("#clientReportSelector").selectOption(id);
    await waitForCleanupGate(id);
    await assertBuffering(id);
    if (index === 0) await page.screenshot({ path: `${output}/loading-desktop.png` });
    if (index === 1) {
      await page.setViewportSize(mobileViewport);
      await assertBuffering(id);
      await page.screenshot({ path: `${output}/loading-mobile.png` });
      await page.setViewportSize(desktopViewport);
    }
    await releaseCleanupGate(id);
    await waitForReady(id);
    const snapshot = await snapshotReport();
    assertFreshBindings(snapshot, id);
    snapshots.push(snapshot);
    console.log(`[report-loading-check] Switch ${index + 1}: buffering remained visible until every section rendered`);
  }

  const [firstA, firstB, restoredA] = snapshots;
  for (const section of firstA.sections) {
    const other = firstB.sections.find((candidate) => candidate.id === section.id);
    if (section.available && other.available) {
      assert.notEqual(section.text, other.text, `Client-specific content changes in ${section.id}`);
    }
  }
  for (const visual of firstA.visuals) {
    const other = firstB.visuals.find((candidate) => candidate.id === visual.id);
    if (visual.available && other.available) {
      assert.ok(visual.html, `Rendered chart: ${visual.id}`);
      assert.notEqual(visual.html, other.html, `Chart data and labels follow the selected client: ${visual.id}`);
    }
  }
  assertRestoredReport(restoredA, firstA, "A → B → A");

  // Finish an older B request while a newer A request remains blocked on cleanup.
  await armCleanupGate(clientB);
  await report.locator("#clientReportSelector").selectOption(clientB);
  await waitForCleanupGate(clientB);
  await armCleanupGate(clientA);
  await report.locator("#clientReportSelector").selectOption(clientA);
  await waitForCleanupGate(clientA);
  await releaseCleanupGate(clientB);
  await report.waitForFunction((id) => window.__reportLoadingCheck.gates[id].calls.every((call) => call.phase === "settled"), clientB, { timeout });
  await assertBuffering(clientA);
  await releaseCleanupGate(clientA);
  await waitForReady(clientA);
  const raceSnapshot = await snapshotReport();
  assertFreshBindings(raceSnapshot, clientA);
  assertRestoredReport(raceSnapshot, firstA, "Stale B completion followed by active A");
  snapshots.push(raceSnapshot);
  await page.screenshot({ path: `${output}/report-ready-desktop.png` });
  writeFileSync(`${output}/report-switch.json`, JSON.stringify(snapshots, null, 2));
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(`[report-loading-check] PASS: loading visibility, fresh content, mobile layout, and stale completion protection. Screenshots: ${output}`);
} finally {
  if (report && !report.isDetached()) {
    await report.evaluate(() => {
      const state = window.__reportLoadingCheck;
      if (!state) return;
      hydrateDashboardNarrativesWithLlmCleanup = state.original;
      Object.values(state.gates).forEach((gate) => gate.release());
      delete window.__reportLoadingCheck;
    }).catch(() => {});
  }
  await context.close();
  await browser.close();
}
