import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportJsPath = path.join(repoRoot, "public", "report.js");

function readReportScript() {
  return fs.readFileSync(reportJsPath, "utf8");
}

test("assigned/client ingestion defines a server-data fallback hydrator", () => {
  const source = readReportScript();

  assert.match(
    source,
    /function\s+applyFallbackAssignedReportFromServerData\s*\(/,
    "Expected report script to define a fallback hydrator for assigned/client report ingestion failures.",
  );
});

test("assigned/client ingestion catch block applies fallback hydrator before exiting", () => {
  const source = readReportScript();

  assert.match(
    source,
    /applyFallbackAssignedReportFromServerData\(data\)[\s\S]*?\[report-ingest\]\s+Assigned PDF ingestion failed/,
    "Expected ingestion failure handling to apply fallback report hydration using server data.",
  );
});
