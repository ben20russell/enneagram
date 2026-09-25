import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");

function text(value) {
  return { nodeType: 3, nodeValue: value, get textContent() { return this.nodeValue; } };
}

function element(tagName, ...children) {
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children.map((child) => typeof child === "string" ? text(child) : child),
    get textContent() { return this.childNodes.map((child) => child.textContent).join(""); },
  };
}

function searchIndex() {
  let hidden = true;
  let reportId = "a";
  const heading = element("div", "Core Patterns");
  const narrative = element("p", "Alpine focus");
  const card = element("article", heading, narrative);
  card.querySelector = () => heading;
  Object.defineProperty(card, "innerText", {
    get: () => hidden ? "" : `${heading.textContent}\n${narrative.textContent}`,
  });
  const section = {
    id: "sec-overview", style: {}, dataset: {},
    querySelectorAll: () => [card],
  };
  const searchResults = { innerHTML: "" };
  const searchStatus = { textContent: "" };
  const searchInput = { value: "" };
  const context = vm.createContext({
    console: { log() {} }, REPORT_MODULES: [], currentSignedInUser: null,
    activeReportSelectionState: { selectionKey: "client-report:a", mode: "client-report" },
    currentClientReportId: "a", currentReportViewMode: "client-report",
    hasAdminAccess: () => false,
    document: {
      body: { dataset: { reportSelectionKey: "client-report:a" } },
      querySelectorAll: (selector) => selector === ".sec" ? [section] : [],
      getElementById: (id) => ({
        searchEverywhereResults: searchResults,
        searchEverywhereStatus: searchStatus,
        searchEverywhereInput: searchInput,
      })[id],
    },
  });
  vm.runInContext(source.slice(source.indexOf("function tokenize("), source.indexOf("function cloneCardForFocus(")), context);
  vm.runInContext(source.slice(source.indexOf("function resetReportScopedUiState("), source.indexOf("function classifyCriticalRenderError(")), context);
  const snapshot = () => JSON.parse(JSON.stringify(context.REPORT_MODULES.map(({ id, text: value, tokens }) => ({ id, text: value, tokens }))));
  return {
    context, card, narrative, searchResults, searchStatus, searchInput,
    setHidden(value) { hidden = value; },
    setReport(id) {
      reportId = id;
      context.document.body.dataset.reportSelectionKey = `client-report:${reportId}`;
      context.activeReportSelectionState.selectionKey = `client-report:${reportId}`;
      context.currentClientReportId = reportId;
      narrative.childNodes = [text(id === "a" ? "Alpine focus" : "Ocean resilience")];
    },
    index() { context.buildReportModuleIndex(); return snapshot(); },
  };
}

test("report search indexes the active section while loading hides its rendered text", () => {
  const ui = searchIndex();
  const loading = ui.index();
  assert.equal(loading.length, 1, "The active section remains searchable after the loading state clears");
  assert.equal(loading[0].text, "Alpine focus");
  ui.setHidden(false);
  assert.deepEqual(ui.index(), loading, "Index content does not depend on report visibility");
});

test("search follows the active report when A to B to A renders occur behind the loading indicator", () => {
  const ui = searchIndex();
  const firstA = ui.index();
  ui.setReport("b");
  const reportB = ui.index();
  assert.equal(reportB.length, 1);
  assert.equal(reportB[0].text, "Ocean resilience");
  assert.ok(reportB[0].tokens.includes("resilience"));
  assert.ok(!reportB[0].tokens.includes("alpine"), "Previous client text is removed from the index");
  ui.setReport("a");
  assert.deepEqual(ui.index(), firstA);
});

test("search preserves block and line-break boundaries without splitting inline words", () => {
  const ui = searchIndex();
  ui.narrative.childNodes = [
    element("strong", "Inter"), text("personal"), element("br"),
    element("span", "awareness"),
    element("div", "Head"), element("div", "27"),
    element("ul", element("li", "Trust"), element("li", "Support")),
  ];
  const modules = ui.index();
  assert.equal(modules.length, 1);
  assert.equal(modules[0].text, "Interpersonal awareness Head 27 Trust Support");
  assert.ok(modules[0].tokens.includes("interpersonal"));
  assert.ok(modules[0].tokens.includes("head"));
  assert.ok(modules[0].tokens.includes("support"));
});

test("switching reports clears the previous search results and count while retaining the query", () => {
  const ui = searchIndex();
  ui.index();
  ui.searchInput.value = "Alpine";
  ui.searchResults.innerHTML = "<div class='search-result'>Alpine focus</div>";
  ui.searchStatus.textContent = "Found 1 matches. Click OPEN on a result to jump there.";

  ui.setReport("b");
  ui.context.resetReportScopedUiState("client-report:b");
  assert.equal(ui.searchResults.innerHTML, "", "Reopening search must not show the previous client's results");
  assert.equal(ui.searchStatus.textContent, "", "The old match count is cleared");
  assert.equal(ui.searchInput.value, "Alpine", "The query remains available to search the new report");
  assert.equal(ui.context.REPORT_MODULES.length, 0, "Previous report modules are invalidated before rebuilding");
  assert.equal(ui.index()[0].text, "Ocean resilience", "Rebuilt search uses the selected report's content");
});
