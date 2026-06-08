import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("assigned report profile builder does not synthesize fake chart scores when scores are missing", () => {
  const script = read(reportJsPath);

  assert.doesNotMatch(
    script,
    /const\s+fallback\s*=\s*order\.map\(\(\)\s*=>\s*40\)\s*;/,
    "Expected assigned report profile builder to avoid synthetic 40-point defaults when scores are missing.",
  );

  assert.doesNotMatch(
    script,
    /fallback\[idx\]\s*=\s*78\s*;/,
    "Expected assigned report profile builder to avoid synthetic dominant-type score defaults.",
  );
});

test("assigned report builder does not replace missing release/stretch lines with canonical type defaults", () => {
  const script = read(reportJsPath);

  assert.doesNotMatch(
    script,
    /const\s+canonicalPoints\s*=\s*CANONICAL_POINTS_BY_TYPE\[typeNumber\]\s*;/,
    "Expected assigned report builder to avoid canonical line substitution when release/stretch are missing.",
  );
});
