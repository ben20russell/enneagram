import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminReviewPanelPath = path.join(repoRoot, "app", "admin-review", "AdminReviewPanel.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin review page no longer includes a link button to admin import", () => {
  const source = read(adminReviewPanelPath);

  assert.doesNotMatch(
    source,
    /data-testid="admin-review-import-link-button"/,
    "Expected admin review import link button test id to be removed.",
  );

  assert.doesNotMatch(
    source,
    />\s*Jump to Admin Import\s*</,
    "Expected admin review import link button copy to be removed.",
  );
});
