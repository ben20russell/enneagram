import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminPagePath = path.join(repoRoot, "app", "admin", "page.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin page composes import and review sections with a visual divider", () => {
  const source = read(adminPagePath);

  assert.match(
    source,
    /import\s+AdminImportForm\s+from\s+["']\.\.\/admin-import\/AdminImportForm["'];/,
    "Expected merged admin page to reuse the admin import form component.",
  );

  assert.match(
    source,
    /import\s+AdminReviewPanel\s+from\s+["']\.\.\/admin-review\/AdminReviewPanel["'];/,
    "Expected merged admin page to reuse the admin review panel component.",
  );

  assert.match(
    source,
    /id="admin-import-section"[\s\S]*?<AdminImportForm\s*\/>/,
    "Expected admin import section to render before other admin sections.",
  );

  assert.match(
    source,
    /data-testid="admin-sections-divider"/,
    "Expected merged admin page to include a dedicated visual divider between sections.",
  );

  assert.match(
    source,
    /id="admin-review-section"[\s\S]*?<AdminReviewPanel\s*\/>/,
    "Expected merged admin page to render the admin review section after the divider.",
  );
});
