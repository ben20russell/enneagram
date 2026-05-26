import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportFormPath = path.join(repoRoot, "app", "admin-import", "AdminImportForm.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import renders a dedicated completion sound element", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /data-testid="admin-import-complete-sound"/,
    "Expected a dedicated completion sound element for assign-report success feedback",
  );
});

test("admin import plays completion sound when assign report finalize succeeds", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /function\s+playCompletionSound\s*\(\)\s*\{/,
    "Expected admin import form to define a completion-sound playback helper",
  );

  assert.match(
    source,
    /if\s*\(\s*finalizeRes\.ok\s*\)\s*\{[\s\S]*?playCompletionSound\s*\(\s*\)/,
    "Expected assign-report success path to play the completion sound",
  );
});

test("admin import parses finalize response text and surfaces fallback diagnostics", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /finalizeRawBody\s*=\s*await\s+finalizeRes\.text\(\)/,
    "Expected finalize flow to read raw response text for non-JSON failures",
  );

  assert.match(
    source,
    /JSON\.parse\(\s*finalizeRawBody\s*\)/,
    "Expected finalize flow to attempt JSON parsing from raw response text",
  );

  assert.match(
    source,
    /HTTP\s*\$\{\s*finalizeRes\.status\s*\}\s*\$\{\s*finalizeRes\.statusText/,
    "Expected finalize error message to include HTTP status diagnostics",
  );
});
