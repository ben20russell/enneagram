import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("assigned report ingestion can infer main type from parsed report content when signed PDF text is unavailable", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /inferTypeFromPdfText\(reportContentText\)/,
    "Expected assigned report ingestion to run type inference against parsed report content text.",
  );

  assert.match(
    script,
    /selectPreferredTypeDetectionResult\(/,
    "Expected assigned report ingestion to prefer the best candidate across PDF text and report content.",
  );
});
