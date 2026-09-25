import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/report.html", import.meta.url), "utf8");
const navStyles = html.match(/^\.nav-wrap\s*\{([^}]+)\}/m)?.[1] || "";

test("section navigation sticks to the viewport top without leaving document flow", () => {
  assert.match(navStyles, /position\s*:\s*sticky(?:;|$)/);
  assert.match(navStyles, /top\s*:\s*0(?:px)?(?:;|$)/);
  const zIndex = Number(navStyles.match(/z-index\s*:\s*(\d+)/)?.[1]);
  assert.ok(zIndex > 2 && zIndex < 130, "Navigation sits above report cards and below menus and dialogs");
});

test("sticky navigation has a solid background and retains horizontal tab scrolling", () => {
  assert.match(navStyles, /background\s*:\s*var\(--surface\)(?:;|$)/);
  assert.match(navStyles, /overflow-x\s*:\s*auto(?:;|$)/);
});

test("section navigation provides a stable test target and accessible landmark name", () => {
  assert.match(html, /<div class="nav-wrap" data-testid="report-section-nav">\s*<nav class="nav" aria-label="Report sections">/);
});

test("desktop search scroll targets clear the sticky bar while mobile and print behavior remain unchanged", () => {
  assert.match(html, /@media\s*\(min-width:\s*761px\)\s*\{\s*html\s*\{\s*scroll-padding-top\s*:\s*76px/);
  assert.match(html, /@media\s*\(max-width:\s*760px\)[^\n]*\.nav-wrap\{display:none\}/);
  assert.match(html, /@media\s+print\s*\{[\s\S]*?\.nav-wrap[^{}]*\{display:none!important\}/);
});
