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
    /const\s+\{\s*parsePdf\s*\}\s*=\s*await\s+import\(\s*["']\.\.\/\.\.\/\.\.\/\.\.\/lib\/parsePdf["']\s*\)/,
    "Expected reparse route to lazy-load parsePdf inside handler",
  );
});
