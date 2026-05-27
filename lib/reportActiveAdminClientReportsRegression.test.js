import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportActiveRoutePath = path.join(repoRoot, "app", "api", "report-active", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("report-active API computes admin access from authenticated user email", () => {
  const routeSource = read(reportActiveRoutePath);

  assert.match(
    routeSource,
    /hasAdminAccess\s*\(\s*normalizeEmail\s*\(\s*userEmail\s*\)\s*\)/,
    "Expected report-active route to derive admin privileges from normalized authenticated user email",
  );
});

test("report-active API includes admin client reports only for admins", () => {
  const routeSource = read(reportActiveRoutePath);

  assert.match(
    routeSource,
    /adminClientReports:\s*isAdmin\s*\?\s*adminClientReports\s*:\s*\[\s*\]/,
    "Expected report-active success response to expose client reports for admins only",
  );
});

test("report-active API scopes client report listing to uploaded admin-import reports", () => {
  const routeSource = read(reportActiveRoutePath);

  assert.match(
    routeSource,
    /\.eq\(\s*"source"\s*,\s*"admin-import"\s*\)/,
    "Expected report-active route to limit client report listing to uploaded admin-import reports",
  );
});
