import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportFormPath = path.join(repoRoot, "app", "admin-import", "AdminImportForm.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import defines local storage key and limit for remembered user emails", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /const\s+REMEMBERED_EMAILS_STORAGE_KEY\s*=\s*["']admin-import-remembered-emails["']/,
    "Expected admin import form to define a dedicated localStorage key for remembered emails",
  );

  assert.match(
    source,
    /const\s+REMEMBERED_EMAILS_LIMIT\s*=\s*\d+/,
    "Expected admin import form to cap remembered email history to a bounded list size",
  );
});

test("admin import reads and writes remembered emails through localStorage", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /localStorage\.getItem\(\s*REMEMBERED_EMAILS_STORAGE_KEY\s*\)/,
    "Expected admin import form to load remembered emails from localStorage",
  );

  assert.match(
    source,
    /localStorage\.setItem\(\s*REMEMBERED_EMAILS_STORAGE_KEY\s*,/,
    "Expected admin import form to persist remembered emails to localStorage",
  );
});

test("admin import renders remembered email suggestions via datalist on the user email input", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /data-testid="admin-import-email-suggestions"/,
    "Expected admin import form to render a datalist for remembered email suggestions",
  );

  assert.match(
    source,
    /list=\{EMAIL_SUGGESTIONS_DATALIST_ID\}/,
    "Expected admin import email input to attach to the remembered-email datalist",
  );
});
