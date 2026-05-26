import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const finalizeLiteRoutePath = path.join(
  repoRoot,
  "app",
  "api",
  "admin-import",
  "finalize-lite",
  "route.js",
);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import finalize-lite route is node runtime and avoids parsePdf import", () => {
  const source = read(finalizeLiteRoutePath);

  assert.match(
    source,
    /export\s+const\s+runtime\s*=\s*["']nodejs["']/,
    "Expected finalize-lite route to pin nodejs runtime",
  );

  assert.doesNotMatch(
    source,
    /parsePdf/,
    "Expected finalize-lite route to avoid heavy parsePdf dependency",
  );
});
