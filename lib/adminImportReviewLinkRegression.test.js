import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportFormPath = path.join(repoRoot, "app", "admin-import", "AdminImportForm.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import page includes a link to admin review", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /<Link[\s\S]*?data-testid="admin-import-review-link"[\s\S]*?href="\/admin-review"[\s\S]*?>[\s\S]*?<\/Link>/,
    "Expected admin import form to include a testable link to /admin-review",
  );
});
