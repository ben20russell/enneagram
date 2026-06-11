import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportFormPath = path.join(repoRoot, "app", "admin-import", "AdminImportForm.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import formats elapsed duration in minutes and seconds", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /Math\.floor\s*\(\s*totalSeconds\s*\/\s*60\s*\)/,
    "Expected duration formatter to derive minutes from elapsed total seconds",
  );

  assert.match(
    source,
    /totalSeconds\s*%\s*60/,
    "Expected duration formatter to derive remaining seconds from elapsed total seconds",
  );
});

test("admin import includes a visible parsing duration counter", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /data-testid="admin-import-parse-duration-counter"/,
    "Expected admin import page to render a parse duration counter element",
  );
});

test("admin import includes a visible parsed pages counter", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /data-testid="admin-import-parse-page-counter"/,
    "Expected admin import page to render a parsed-pages counter element",
  );
});

test("admin import includes a visible parse noise indicator", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /data-testid="admin-import-parse-noise-indicator"/,
    "Expected admin import page to render a parse-noise indicator element.",
  );
});

test("admin import reads parse noise from route and nested diagnostics payloads", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /data\?\.parseNoise/,
    "Expected admin import parse noise helper to read top-level parseNoise values.",
  );

  assert.match(
    source,
    /data\?\.data\?\.parseNoise/,
    "Expected admin import parse noise helper to read wrapped parseNoise values.",
  );

  assert.match(
    source,
    /data\?\._parseDiagnostics\?\.verification\?\.python\?\.textNoise/,
    "Expected admin import parse noise helper to read nested python text-noise diagnostics.",
  );
});

test("admin import no longer renders assignment duration counter", () => {
  const source = read(adminImportFormPath);

  assert.doesNotMatch(
    source,
    /data-testid="admin-import-duration-counter"/,
    "Expected admin import page to remove assignment duration counter UI",
  );
});

test("admin import shows parsing status updates", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /setParseStatus\(\s*"Parsing report now\.\.\."\s*\)/,
    "Expected parse-on-page flow to set an in-progress parsing status message",
  );

  assert.match(
    source,
    /Parsing complete in\s+\$\{durationText\}/,
    "Expected successful background parse status to include duration text",
  );

  assert.match(
    source,
    /Pages parsed:\s+\$\{parsedPagesText\}/,
    "Expected successful parse status to include parsed-pages progress text",
  );
});

test("admin import marks parse status complete when parsed pages reach detected total pages", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /const\s+isPageCoverageComplete\s*=\s*parseDetectedTotalPages\s*>\s*0\s*&&\s*parsePages\s*!=\s*null\s*&&\s*parsePages\s*>=\s*parseDetectedTotalPages/,
    "Expected parse flow to compute complete page coverage from parsed and detected totals",
  );

  assert.match(
    source,
    /const\s+parseState\s*=\s*isPageCoverageComplete\s*\?\s*["']complete["']\s*:\s*parseStateFromResponse/,
    "Expected parse flow to force complete status when all detected pages are parsed",
  );
});

test("admin import typography uses dashboard font families", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /const\s+DASHBOARD_SANS_FONT_FAMILY\s*=\s*["'`].*Plus Jakarta Sans.*Segoe UI.*Roboto.*Arial.*["'`]/,
    "Expected admin import page to define the dashboard sans font stack",
  );

  assert.match(
    source,
    /fontFamily:\s*DASHBOARD_SANS_FONT_FAMILY/,
    "Expected admin import container to use the dashboard sans font stack",
  );

  assert.match(
    source,
    /const\s+DASHBOARD_DISPLAY_FONT_FAMILY\s*=\s*["'`].*Space Grotesk.*Plus Jakarta Sans.*["'`]/,
    "Expected admin import page to define the dashboard display font stack",
  );

  assert.match(
    source,
    /fontFamily:\s*DASHBOARD_DISPLAY_FONT_FAMILY/,
    "Expected admin import title to use the dashboard display font stack",
  );
});

test("admin import page left-aligns the heading copy and import card", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /data-testid="admin-import-page"[\s\S]*?textAlign:\s*"left"/,
    "Expected admin import page container copy to be left-aligned",
  );

  assert.match(
    source,
    /data-testid="admin-import-card"[\s\S]*?margin:\s*"20px 0 0"/,
    "Expected admin import card to align left instead of centered",
  );
});
