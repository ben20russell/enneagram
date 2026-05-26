import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportFormPath = path.join(repoRoot, "app", "admin-import", "AdminImportForm.jsx");
const loginButtonPath = path.join(repoRoot, "app", "components", "LoginButton.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import close handler always attempts window close first", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /function\s+handleCloseWindow\s*\(\)\s*\{[\s\S]*?window\.close\(\);/,
    "Expected close handler to call window.close()",
  );

  assert.doesNotMatch(
    source,
    /function\s+handleCloseWindow\s*\(\)\s*\{[\s\S]*?if\s*\(\s*!window\.opener\s*\)/,
    "Expected close handler to not block close attempts when opener is unavailable",
  );
});

test("admin import account link opens a new tab without noopener so close button can work", () => {
  const source = read(loginButtonPath);
  const adminImportLinkBlock = source.match(
    /<Link[\s\S]*?data-testid="admin-import-link"[\s\S]*?<\/Link>/,
  )?.[0];

  assert.ok(adminImportLinkBlock, "Expected to find admin import link block");

  assert.match(
    adminImportLinkBlock,
    /target="_blank"/,
    "Expected admin import link to open in a new tab",
  );

  assert.doesNotMatch(
    adminImportLinkBlock,
    /rel="noopener noreferrer"/,
    "Expected admin import link to keep window opener for close-window action",
  );
});
