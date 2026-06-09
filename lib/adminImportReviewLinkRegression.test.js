import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportFormPath = path.join(repoRoot, "app", "admin-import", "AdminImportForm.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import page includes a button to admin review", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /function\s+handleOpenAdminReview\s*\(\)\s*\{[\s\S]*?router\.push\(\s*"\/admin-review"\s*\)/,
    "Expected admin import page to navigate to /admin-review through a dedicated button handler.",
  );

  assert.match(
    source,
    /<button[\s\S]*?data-testid="admin-import-review-button"[\s\S]*?onClick=\{handleOpenAdminReview\}[\s\S]*?>[\s\S]*?Open Admin Review[\s\S]*?<\/button>/,
    "Expected admin import form to include a button that opens admin review.",
  );

  assert.doesNotMatch(
    source,
    /<Link[\s\S]*?href="\/admin-review"/,
    "Expected admin import form to avoid Link-based admin review navigation.",
  );
});
