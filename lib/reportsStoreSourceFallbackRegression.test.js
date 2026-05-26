import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportsStorePath = path.join(repoRoot, "lib", "reportsStore.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("reports store retries createReport insert without source when source column is missing", () => {
  const source = read(reportsStorePath);

  assert.match(
    source,
    /if\s*\(\s*insertError\s*&&\s*isMissingSourceColumnError\s*\(\s*insertError\s*\)\s*\)/,
    "Expected createReport to detect missing source-column insert errors",
  );

  assert.match(
    source,
    /const\s+\{\s*source:\s*_ignoredSource,\s*\.\.\.payloadWithoutSource\s*\}\s*=\s*payload;/,
    "Expected createReport to strip source from payload for compatibility retry",
  );

  assert.match(
    source,
    /insert\s*\(\s*payloadWithoutSource\s*\)/,
    "Expected createReport to retry insert without source",
  );
});

test("reports store falls back to results_data ingestion markers when source column is missing", () => {
  const source = read(reportsStorePath);

  assert.match(
    source,
    /if\s*\(\s*error\s*&&\s*isMissingSourceColumnError\s*\(\s*error\s*\)\s*\)/,
    "Expected assigned-report lookup to detect missing source-column query errors",
  );

  assert.match(
    source,
    /looksLikeAdminImportReport\s*\(/,
    "Expected assigned-report fallback to filter by admin-import ingestion markers",
  );

  assert.match(
    source,
    /ingestionMode\s*===\s*"admin-import-auto"/,
    "Expected admin-import ingestion mode to be used for fallback filtering",
  );
});
