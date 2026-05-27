import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const applyParsedRoutePath = path.join(
  repoRoot,
  "app",
  "api",
  "admin-import",
  "apply-parsed",
  "route.js",
);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import apply-parsed route pins node runtime and avoids parsePdf import", () => {
  const source = read(applyParsedRoutePath);

  assert.match(
    source,
    /export\s+const\s+runtime\s*=\s*["']nodejs["']/,
    "Expected apply-parsed route to explicitly use nodejs runtime",
  );

  assert.doesNotMatch(
    source,
    /parsePdf/,
    "Expected apply-parsed route to avoid direct parsePdf dependency for stability",
  );
});

test("admin import apply-parsed route keeps maxDuration within Vercel Hobby limits", () => {
  const source = read(applyParsedRoutePath);

  const match = source.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  assert.ok(match, "Expected apply-parsed route to export maxDuration");

  const maxDuration = Number(match[1]);
  assert.ok(
    Number.isFinite(maxDuration) && maxDuration >= 1 && maxDuration <= 300,
    "Expected apply-parsed maxDuration to stay within Hobby plan serverless limits (1-300s)",
  );
});

test("admin import apply-parsed route updates report rows via Supabase admin client", () => {
  const source = read(applyParsedRoutePath);

  assert.match(
    source,
    /getSupabaseAdmin/,
    "Expected apply-parsed route to use Supabase admin access for report updates",
  );

  assert.match(
    source,
    /\.update\(\s*\{/,
    "Expected apply-parsed route to persist parsed report updates",
  );
});
