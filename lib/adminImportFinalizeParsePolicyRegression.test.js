import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportRoutePath = path.join(repoRoot, "app", "api", "admin-import", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import finalize gates parsing behind explicit env flag", () => {
  const source = read(adminImportRoutePath);

  assert.match(
    source,
    /const\s+shouldParseOnFinalize\s*=\s*String\s*\(\s*process\.env\.ADMIN_IMPORT_PARSE_ON_FINALIZE\s*\|\|\s*""\s*\)\.toLowerCase\(\)\s*===\s*"true"/,
    "Expected finalize parsing to require ADMIN_IMPORT_PARSE_ON_FINALIZE=true",
  );

  assert.match(
    source,
    /if\s*\(\s*shouldParseOnFinalize\s*\)\s*\{/,
    "Expected parse flow to run only when explicit parse-on-finalize flag is enabled",
  );

  assert.match(
    source,
    /\[admin-import\]\s+Skipping parse during finalize; using metadata-only import/,
    "Expected finalize flow to log when parse is skipped for reliability",
  );
});

test("admin import route avoids top-level parsePdf import and uses lazy import in parse branch", () => {
  const source = read(adminImportRoutePath);

  assert.doesNotMatch(
    source,
    /import\s+\{\s*parsePdf\s*\}\s+from\s+["']\.\.\/\.\.\/\.\.\/lib\/parsePdf(\.js)?["']/,
    "Expected route module to avoid top-level parsePdf import that can crash at compile/load time",
  );

  assert.match(
    source,
    /const\s+\{\s*parsePdf\s*\}\s*=\s*await\s+import\(\s*["']\.\.\/\.\.\/\.\.\/lib\/parsePdf\.js["']\s*\)/,
    "Expected parsePdf to be lazy-loaded within guarded parse flow",
  );
});

test("admin import route explicitly pins node runtime", () => {
  const source = read(adminImportRoutePath);

  assert.match(
    source,
    /export\s+const\s+runtime\s*=\s*["']nodejs["']/,
    "Expected admin import route to explicitly use nodejs runtime for PDF/Buffer-safe execution",
  );
});

test("admin import route keeps maxDuration within Vercel Hobby limits", () => {
  const source = read(adminImportRoutePath);

  const match = source.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  assert.ok(match, "Expected admin import route to export maxDuration");

  const maxDuration = Number(match[1]);
  assert.ok(
    Number.isFinite(maxDuration) && maxDuration >= 1 && maxDuration <= 300,
    "Expected admin import maxDuration to stay within Hobby plan serverless limits (1-300s)",
  );
});

test("admin import route supports explicit JSON reparse action fallback", () => {
  const source = read(adminImportRoutePath);

  assert.match(
    source,
    /const\s+action\s*=\s*String\s*\(\s*body\?\.action\s*\|\|\s*""\s*\)\.trim\(\)\.toLowerCase\(\)/,
    "Expected JSON body handling to normalize an explicit action field",
  );

  assert.match(
    source,
    /if\s*\(\s*action\s*===\s*"reparse"\s*\)\s*\{/,
    "Expected admin import route to branch into reparse handling when requested",
  );

  assert.match(
    source,
    /reparseImportedReport/,
    "Expected route to expose a dedicated reparse helper for fallback parsing",
  );
});
