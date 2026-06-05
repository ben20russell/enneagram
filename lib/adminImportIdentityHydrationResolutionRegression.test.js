import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const routePaths = [
  path.join(repoRoot, "app", "api", "admin-import", "route.js"),
  path.join(repoRoot, "app", "api", "admin-import", "reparse", "route.js"),
  path.join(repoRoot, "app", "api", "admin-import", "apply-parsed", "route.js"),
];

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import routes derive hydration identity fields from verification-resolved values", () => {
  for (const routePath of routePaths) {
    const source = read(routePath);

    assert.match(
      source,
      /function\s+resolveHydrationIdentityFields\s*\(/,
      "Expected route to define hydration identity field resolution helper.",
    );

    assert.match(
      source,
      /const\s+resolvedIdentity\s*=\s*resolveHydrationIdentityFields\(/,
      "Expected route to resolve identity from parsed + verification diagnostics before hydration.",
    );

    assert.match(
      source,
      /dashboardContext:\s*\{[\s\S]*detectedType:\s*resolvedIdentity\.primaryType[\s\S]*integrationLevel:\s*resolvedIdentity\.integrationLevel[\s\S]*instinct:\s*resolvedIdentity\.instinctualVariant/,
      "Expected dashboard context hydration to use resolved identity fields for type, integration, and instinct.",
    );
  }
});
