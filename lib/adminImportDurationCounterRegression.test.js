import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportFormPath = path.join(repoRoot, "app", "admin-import", "AdminImportForm.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import includes a visible assignment duration counter", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /data-testid="admin-import-duration-counter"/,
    "Expected admin import page to render a duration counter element",
  );
});

test("admin import formats assignment duration in minutes and seconds", () => {
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

test("admin import success status includes assignment duration", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /Success!\s*Report assigned to.*in\s+\$\{durationText\}/,
    "Expected success status to include human-readable assignment duration",
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

test("admin import shows parsing status updates", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /setParseStatus\(\s*"Parsing report in background\.\.\."\s*\)/,
    "Expected background parse flow to set an in-progress parsing status message",
  );

  assert.match(
    source,
    /Parsing complete in\s+\$\{durationText\}/,
    "Expected successful background parse status to include duration text",
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
