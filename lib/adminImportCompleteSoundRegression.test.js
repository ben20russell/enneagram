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

test("admin import plays completion sound when parse flow finishes (complete/incomplete/failed)", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /function\s+playCompletionSound\s*\(\s*outcome\s*=\s*["']unknown["']\s*\)\s*\{/,
    "Expected admin import form to define a completion-sound playback helper with parse outcome context",
  );

  assert.match(
    source,
    /let\s+parseOutcome\s*=\s*["']failed["']/,
    "Expected parse flow to default completion-sound outcome to failed until parse succeeds",
  );

  assert.match(
    source,
    /parseOutcome\s*=\s*parseState\s*===\s*["']complete["']\s*\?\s*["']complete["']\s*:\s*["']incomplete["']/,
    "Expected parse flow to classify successful parse outcomes as complete or incomplete before playing sound",
  );

  assert.match(
    source,
    /finally\s*\{[\s\S]*?playCompletionSound\s*\(\s*parseOutcome\s*\)/,
    "Expected completion sound to play when parse flow finishes, regardless of success or failure",
  );
});

test("admin import does not play completion sound immediately on finalize success", () => {
  const source = read(adminImportFormPath);

  assert.doesNotMatch(
    source,
    /if\s*\(\s*finalizeRes\.ok\s*\)\s*\{[\s\S]*?playCompletionSound\s*\(/,
    "Expected primary finalize success path to avoid playing completion sound before parse finishes",
  );

  assert.doesNotMatch(
    source,
    /if\s*\(\s*liteRes\.ok\s*\)\s*\{[\s\S]*?playCompletionSound\s*\(/,
    "Expected lite finalize success path to avoid playing completion sound before parse finishes",
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

test("admin import retries with lightweight finalize route when primary finalize returns 5xx", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /finalizeRes\.status\s*>=\s*500/,
    "Expected finalize flow to treat 5xx primary finalize responses as retryable",
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
    /endpoint:\s*"\/api\/admin-import\/reparse"/,
    "Expected admin import parse flow to include legacy reparse endpoint as a fallback attempt",
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

test("admin import can fallback to client-side PDF parse and apply-parsed persistence", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /fetch\(\s*"\/api\/pdf\/parse"\s*,/,
    "Expected admin import parse flow to support PDF upload parse fallback",
  );

  assert.match(
    source,
    /fetch\(\s*"\/api\/admin-import\/apply-parsed"\s*,/,
    "Expected admin import parse flow to persist parsed payload via apply-parsed fallback route",
  );
});
