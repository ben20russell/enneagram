import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const routePath = path.join(process.cwd(), "app", "api", "admin-review", "resave-graded", "route.js");

function readRoute() {
  return readFileSync(routePath, "utf8");
}

test("admin review bulk re-save route scopes to imported reports and persists normalized identity fields", () => {
  const source = readRoute();

  assert.match(
    source,
    /\.from\(table\)\s*\.select\("id,user_email,enneagram_type,results_data,report_pdf"\)\s*\.eq\("source",\s*"admin-import"\)\s*\.order\("created_at",\s*\{\s*ascending:\s*false\s*\}\)\s*\.range\(offset,\s*toIndex\)/s,
    "Expected bulk re-save route to scope to admin-import reports and load required fields.",
  );

  assert.match(
    source,
    /\.update\(\{\s*results_data:\s*nextResults,\s*enneagram_type:\s*persistedEnneagramTypeNumber\s*\}\)/s,
    "Expected bulk re-save route to persist both results_data and enneagram_type columns.",
  );

  assert.match(
    source,
    /admin-review:bulk-resave/,
    "Expected bulk re-save route to mark dashboard detectedTypeSource as bulk-resave.",
  );
});

test("admin review bulk re-save route re-runs sanitize and parse pipeline against stored PDFs", () => {
  const source = readRoute();

  assert.match(
    source,
    /import\s+\{\s*(?:resolvePdfSanitizeFormFieldMode,\s*)?sanitizePdfForParsing\s*\}\s+from\s+["']\.\.\/\.\.\/\.\.\/\.\.\/lib\/pdfSanitize\.js["']/,
    "Expected bulk re-save route to import shared PDF sanitization helpers.",
  );

  assert.match(
    source,
    /\.storage\.from\(bucket\)\.download\(storagePath\)/,
    "Expected bulk re-save route to download stored PDF bytes before parsing.",
  );

  assert.match(
    source,
    /const\s+sanitizedPdf\s*=\s*await\s+sanitizePdfForParsing\(\s*pdfBuffer\s*,\s*\{/,
    "Expected bulk re-save route to sanitize raw PDF bytes before parse.",
  );

  assert.match(
    source,
    /parsePdf\(\s*sanitizedPdf\.buffer\s*,\s*\{[\s\S]*disableImagePipeline:\s*true[\s\S]*disableImageScoreRescue:\s*true[\s\S]*allowLocalTextFallback:\s*true[\s\S]*enablePythonCrossCheck:\s*true[\s\S]*\}\s*\)/,
    "Expected bulk re-save route to parse the sanitized buffer with the same safe server pipeline options.",
  );

  assert.match(
    source,
    /buildMlExtractionLearningContextFromReportRows/,
    "Expected bulk re-save route to build extraction-learning context from reviewed rows",
  );

  assert.match(
    source,
    /extractionLearningContext/,
    "Expected bulk re-save parse calls to include extraction-learning context",
  );
});

test("admin review bulk re-save route returns summary metrics for admin visibility", () => {
  const source = readRoute();

  assert.match(
    source,
    /NextResponse\.json\(/,
    "Expected bulk re-save route to return processing summary and failures list.",
  );

  assert.match(source, /success:\s*true/);
  assert.match(source, /processedCount/);
  assert.match(source, /updatedCount/);
  assert.match(source, /skippedCount/);
  assert.match(source, /failedCount/);
  assert.match(source, /scannedCount/);
  assert.match(source, /gradedCount/);
  assert.match(source, /failures/);
});
