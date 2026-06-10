import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportFormPath = path.join(repoRoot, "app", "admin-import", "AdminImportForm.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import page no longer includes a button to admin review", () => {
  const source = read(adminImportFormPath);

  assert.doesNotMatch(
    source,
    /function\s+handleOpenAdminReview\s*\(\)\s*\{/,
    "Expected admin import review button handler to be removed.",
  );

  assert.doesNotMatch(
    source,
    /data-testid="admin-import-review-button"/,
    "Expected admin import review button test id to be removed.",
  );

  assert.doesNotMatch(
    source,
    />\s*Open Admin Review\s*</,
    "Expected admin import review button copy to be removed.",
  );
});
