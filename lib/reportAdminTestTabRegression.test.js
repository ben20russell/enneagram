import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportHtmlPath = path.join(repoRoot, "public", "report.html");
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("dashboard exposes a dedicated admin-only TEST tab", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /data-sec="growth"[^>]*>Growth Path<\/button>[\s\S]*data-sec="test"[^>]*>TEST<\/button>/,
    "Expected TEST tab to be appended after Growth Path in desktop nav.",
  );

  assert.match(
    html,
    /class="mobile-menu-item"[^>]*data-sec="test"[^>]*>TEST<\/button>/,
    "Expected TEST tab to be exposed in mobile nav as well.",
  );

  assert.match(
    html,
    /id="sec-test"/,
    "Expected diagnostics cards to be rendered in a dedicated TEST section.",
  );

  assert.doesNotMatch(
    html,
    /id="overviewAdminDiagnostics"/,
    "Expected admin diagnostics container to be removed from Overview section.",
  );
});

test("TEST tab visibility and module indexing are gated by admin access", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /querySelectorAll\('\.nav button\[data-sec="test"\],\.mobile-menu-item\[data-sec="test"\]'\)/,
    "Expected script to locate all TEST nav controls for visibility toggling.",
  );

  assert.match(
    script,
    /const\s+isAdmin\s*=\s*hasAdminAccess\(email\);/,
    "Expected TEST tab visibility to derive from hasAdminAccess(email).",
  );

  assert.match(
    script,
    /diagnosticsSection\.style\.display\s*=\s*isAdmin\s*\?\s*""\s*:\s*"none"/,
    "Expected TEST section visibility to clear inline display for admins so sec/active CSS controls visibility.",
  );

  assert.match(
    script,
    /if\s*\(!isAdmin\s*&&\s*currentSectionId\s*===\s*["']test["']\)\s*\{\s*showSec\(['"]overview['"]\);/,
    "Expected non-admin users to be redirected away from TEST section.",
  );

  assert.match(
    script,
    /sectionId\s*===\s*['"]test['"]\s*&&\s*!hasAdminAccess\(currentSignedInUser\?\.email\)/,
    "Expected search module index to skip TEST modules for non-admin users.",
  );
});
