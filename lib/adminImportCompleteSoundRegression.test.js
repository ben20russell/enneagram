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

test("admin import retries with lightweight finalize route when Next error html is returned", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /includes\(\s*"__next_error__"\s*\)/,
    "Expected finalize flow to detect Next.js HTML error page markers",
  );

  assert.match(
    source,
    /fetch\(\s*"\/api\/admin-import\/finalize-lite"/,
    "Expected finalize flow to retry against lightweight finalize endpoint when primary route fails hard",
  );
});

test("admin import parses assigned report inline after successful assignment", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /async\s+function\s+parseAssignedReport\s*\(\s*reportId\s*\)\s*\{/,
    "Expected admin import form to define an inline parse helper for assigned reports",
  );

  assert.match(
    source,
    /fetch\(\s*"\/api\/admin-import\/reparse"/,
    "Expected admin import success flow to call reparse endpoint for parse-on-page behavior",
  );

  assert.match(
    source,
    /await\s+parseAssignedReport\s*\(/,
    "Expected admin import success flow to await parsing on the importer page",
  );

  assert.doesNotMatch(
    source,
    /void\s+triggerBackgroundParse\s*\(/,
    "Expected admin import success flow to avoid detached background parse calls",
  );
});

test("admin import retries parsing via primary admin-import route when reparse returns Next html error", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /rawBody\.includes\(\s*"__next_error__"\s*\)/,
    "Expected parse flow to detect Next.js HTML error responses from reparse endpoint",
  );

  assert.match(
    source,
    /fetch\(\s*"\/api\/admin-import"\s*,/,
    "Expected parse flow to fallback to primary admin-import route when reparse route crashes",
  );

  assert.match(
    source,
    /action:\s*"reparse"/,
    "Expected parse fallback payload to explicitly request reparse action",
  );
});
