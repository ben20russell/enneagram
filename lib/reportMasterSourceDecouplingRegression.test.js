import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const dashboardRuntimeFiles = [
  path.join(repoRoot, "public", "report.js"),
  path.join(repoRoot, "public", "report.html"),
  path.join(repoRoot, "app", "page.jsx"),
  path.join(repoRoot, "app", "dashboard", "page.jsx"),
  path.join(repoRoot, "app", "report", "page.jsx"),
  path.join(repoRoot, "app", "api", "report-active", "route.js"),
  path.join(repoRoot, "app", "api", "report-pdf", "route.js"),
];

const forbiddenSourcePatterns = [
  /ENNEAGRAM_MASTER\.md/i,
  /enneagram-master-source\.(txt|json)/i,
  /docs\/enneagram-master-source/i,
];

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("dashboard runtime stays decoupled from archival enneagram master source files", () => {
  for (const filePath of dashboardRuntimeFiles) {
    const source = read(filePath);
    for (const pattern of forbiddenSourcePatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `Expected ${path.relative(repoRoot, filePath)} to remain decoupled from archival master source files.`,
      );
    }
  }
});
