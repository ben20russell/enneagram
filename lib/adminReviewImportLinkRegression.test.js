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
    /<Link[\s\S]*?data-testid="admin-review-import-link-button"[\s\S]*?href="\/admin-import"[\s\S]*?>[\s\S]*?Open Admin Import[\s\S]*?<\/Link>/,
    "Expected admin review panel to include a link button to /admin-import.",
  );
});
