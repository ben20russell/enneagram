import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const adminImportFormPath = path.join(repoRoot, "app", "admin-import", "AdminImportForm.jsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("admin import parse retries when a 200 response is incomplete with unusable coverage", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /attemptResponse\.ok[\s\S]*parseStateFromAttempt[\s\S]*incomplete[\s\S]*hasAttemptUsableCoverage[\s\S]*break/,
    "Expected parse attempt loop to break only when the parse response is successful and has usable coverage.",
  );
});

test("admin import parse progress resolves min expected pages from nested parse diagnostics", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /data\?\._parseDiagnostics\?\.extraction\?\.minExpectedPages/,
    "Expected parse progress helper to read nested minExpectedPages from parse diagnostics.",
  );

  assert.match(
    source,
    /data\?\.data\?\._parseDiagnostics\?\.extraction\?\.minExpectedPages/,
    "Expected parse progress helper to read nested minExpectedPages from wrapped parse diagnostics payloads.",
  );
});

test("admin import status messaging appends parse reason for incomplete and failed outcomes", () => {
  const source = read(adminImportFormPath);

  assert.match(
    source,
    /parseReason/i,
    "Expected parse flow to read normalized parseReason fields from route responses.",
  );

  assert.match(
    source,
    /Status:\s*\$\{parseState\}\.[\s\S]*Reason:/,
    "Expected incomplete parse status text to include parse reason context.",
  );
});
