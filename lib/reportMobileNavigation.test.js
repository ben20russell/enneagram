import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");
const showSec = source.slice(source.indexOf("function showSec("), source.indexOf("function toggleSearchPopout("));

function navigation() {
  const makeElement = (active = false) => {
    const classes = new Set(active ? ["active"] : []);
    return {
      classList: { add: (key) => classes.add(key), remove: (key) => classes.delete(key), contains: (key) => classes.has(key) },
      setAttribute() {}, removeAttribute() {}, scrollIntoView() {},
    };
  };
  const overview = makeElement(true);
  const growth = makeElement();
  const button = { ...makeElement(), textContent: "Growth Path" };
  const label = { textContent: "Overview" };
  const context = {
    console: { log() {} }, currentSignedInUser: null, hasAdminAccess: () => false,
    document: {
      body: { dataset: { reportSelectionKey: "example:3" } },
      getElementById: (id) => ({ "sec-overview": overview, "sec-growth": growth, mobileSectionLabel: label })[id],
      querySelectorAll: (selector) => selector === ".sec" ? [overview, growth] : [button],
      querySelector: () => button,
    },
    window: { matchMedia: () => ({ matches: true }), scrollTo() {} },
  };
  vm.createContext(context);
  vm.runInContext(showSec, context);
  return { context, overview, growth, label };
}

test("an invalid navigation target keeps the current report section visible", () => {
  const { context, overview } = navigation();
  context.showSec("missing");
  assert.equal(overview.classList.contains("active"), true);
});

test("mobile navigation announces the selected section and displays its content", () => {
  const { context, overview, growth, label } = navigation();
  context.showSec("growth");
  assert.equal(label.textContent, "Growth Path");
  assert.equal(overview.classList.contains("active"), false);
  assert.equal(growth.classList.contains("active"), true);
});
