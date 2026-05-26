import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reparseRoutePath = path.join(repoRoot, "app", "api", "admin-import", "reparse", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import reparse route pins node runtime and lazily imports parsePdf", () => {
  const source = read(reparseRoutePath);

  assert.match(
    source,
    /export\s+const\s+runtime\s*=\s*["']nodejs["']/,
    "Expected reparse route to explicitly run in nodejs runtime",
  );

  assert.doesNotMatch(
    source,
    /import\s+\{\s*parsePdf\s*\}\s+from/,
    "Expected reparse route to avoid top-level parsePdf imports",
  );

  assert.match(
    source,
    /const\s+\{\s*parsePdf\s*\}\s*=\s*await\s+import\(\s*["']\.\.\/\.\.\/\.\.\/\.\.\/lib\/parsePdf\.js["']\s*\)/,
    "Expected reparse route to lazy-load parsePdf inside handler",
  );
});

test("admin import reparse route persists parse failure diagnostics back to results_data", () => {
  const source = read(reparseRoutePath);

  assert.match(
    source,
    /Reparse failed:/,
    "Expected reparse route to stamp parse failure details into ingestion diagnostics",
  );

  assert.match(
    source,
    /parseAttempt/,
    "Expected reparse route to persist parse attempt telemetry into results_data",
  );
});

test("admin import reparse route allows long-running parse durations", () => {
  const source = read(reparseRoutePath);

  const match = source.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  assert.ok(match, "Expected reparse route to export maxDuration");

  const maxDuration = Number(match[1]);
  assert.ok(
    Number.isFinite(maxDuration) && maxDuration >= 600,
    "Expected reparse maxDuration to support long-running 42-page parsing (>= 600s)",
  );
});
