import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("client report ingestion tracks an active request token to avoid stale async apply", () => {
  const script = read(reportScriptPath);

  assert.match(
    script,
    /let\s+activeAssignedIngestionToken\s*=\s*0\s*;/,
    "Expected report script to track the currently active assigned/client ingestion token.",
  );

  assert.match(
    script,
    /const\s+ingestionToken\s*=\s*activeAssignedIngestionToken\s*\+\s*1\s*;\s*[\s\S]*activeAssignedIngestionToken\s*=\s*ingestionToken\s*;/,
    "Expected ingestion flow to increment and assign a new active token per assigned/client ingestion request.",
  );

  assert.match(
    script,
    /if\s*\(\s*ingestionToken\s*!==\s*activeAssignedIngestionToken\s*\)\s*\{[\s\S]*?stale ingestion payload/i,
    "Expected ingest flow to skip stale async payloads when a newer client-report selection exists.",
  );
});
