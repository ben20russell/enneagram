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
