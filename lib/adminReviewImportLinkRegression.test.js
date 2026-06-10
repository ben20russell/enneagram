import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminReviewPanelPath = path.join(repoRoot, "app", "admin-review", "AdminReviewPanel.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin review page includes a link button to admin import", () => {
  const source = read(adminReviewPanelPath);

  assert.match(
    source,
    /<section[\s\S]*?data-testid="admin-review-header-row"[\s\S]*?justifyContent:\s*"space-between"[\s\S]*?>/,
    "Expected admin review page header to use a top row with right-aligned actions.",
  );

  assert.match(
    source,
    /<section[\s\S]*?data-testid="admin-review-header-row"[\s\S]*?<Link[\s\S]*?data-testid="admin-review-import-link-button"[\s\S]*?href="\/admin#admin-import-section"[\s\S]*?>[\s\S]*?Jump to Admin Import[\s\S]*?<\/Link>/,
    "Expected admin review panel to place the import button in the top-right header row and target the admin import section.",
  );
});
