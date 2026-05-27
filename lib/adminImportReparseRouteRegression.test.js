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

test("admin import reparse route keeps maxDuration within Vercel Hobby limits", () => {
  const source = read(reparseRoutePath);

  const match = source.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  assert.ok(match, "Expected reparse route to export maxDuration");

  const maxDuration = Number(match[1]);
  assert.ok(
    Number.isFinite(maxDuration) && maxDuration >= 1 && maxDuration <= 300,
    "Expected reparse maxDuration to stay within Hobby plan serverless limits (1-300s)",
  );
});

test("admin import reparse route guards Supabase admin client initialization with route-level error handling", () => {
  const source = read(reparseRoutePath);

  assert.match(
    source,
    /let\s+supabase\s*=\s*null\s*;/,
    "Expected reparse route to keep a nullable Supabase client reference for guarded failures",
  );

  assert.match(
    source,
    /try\s*\{[\s\S]*?supabase\s*=\s*getSupabaseAdmin\s*\(\s*\)\s*;/,
    "Expected reparse route to initialize Supabase admin client inside try/catch scope",
  );

  assert.doesNotMatch(
    source,
    /const\s+supabase\s*=\s*getSupabaseAdmin\s*\(\s*\)\s*;/,
    "Expected reparse route to avoid unguarded top-level Supabase admin initialization",
  );
});

test("admin import reparse route guards session initialization with route-level error handling", () => {
  const source = read(reparseRoutePath);

  assert.match(
    source,
    /try\s*\{[\s\S]*?const\s+session\s*=\s*await\s+getServerSession\s*\(\s*authOptions\s*\)/,
    "Expected reparse route to call getServerSession inside route-level try/catch scope",
  );
});

test("admin import reparse route uses safe parse options for serverless stability", () => {
  const source = read(reparseRoutePath);

  assert.match(
    source,
    /parsePdf\(\s*pdfBuffer\s*,\s*\{[\s\S]*disableImagePipeline:\s*true[\s\S]*disableImageScoreRescue:\s*true[\s\S]*\}\s*\)/,
    "Expected reparse route parse call to disable image pipeline and image score rescue",
  );
});
