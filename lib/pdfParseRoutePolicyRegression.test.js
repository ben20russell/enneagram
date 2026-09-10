import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const pdfParseRoutePath = path.join(repoRoot, "app", "api", "pdf", "parse", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("pdf parse route passes non-blocking completeness policy without image parsing options", () => {
  const source = read(pdfParseRoutePath);

  assert.match(
    source,
    /parsePdf\(\s*sanitizedPdf\.buffer\s*,\s*\{[\s\S]*requireChartScoresForComplete:\s*false[\s\S]*enablePythonCrossCheck:\s*true[\s\S]*\}\s*\)/,
    "Expected pdf parse route to disable strict chart-score completeness blocking and enable Python text cross-checking",
  );
});

test("pdf parse route sanitizes uploaded pdf bytes before parse", () => {
  const source = read(pdfParseRoutePath);

  assert.match(
    source,
    /import\s+\{\s*(?:resolvePdfSanitizeFormFieldMode,\s*)?sanitizePdfForParsing\s*\}\s+from\s+["']\.\.\/\.\.\/\.\.\/\.\.\/lib\/pdfSanitize\.js["']/,
    "Expected /api/pdf/parse route to import the shared PDF sanitizer helper",
  );

  assert.match(
    source,
    /const\s+sanitizedPdf\s*=\s*await\s+sanitizePdfForParsing\(\s*buffer\s*,\s*\{/,
    "Expected /api/pdf/parse route to sanitize uploaded PDF bytes before parsing",
  );

  assert.match(
    source,
    /parsePdf\(\s*sanitizedPdf\.buffer\s*,\s*\{/,
    "Expected /api/pdf/parse route to parse the sanitized buffer, not the raw upload",
  );
});

test("pdf parse route does not expose image parsing controls", () => {
  const source = read(pdfParseRoutePath);

  assert.doesNotMatch(
    source,
    /DEFAULT_ROUTE_IMAGE_PAGE_LIMIT|imagePrimaryFullDocMaxPages|disableImagePipeline/,
    "Expected pdf parse route to avoid image parsing controls",
  );
});

test("pdf parse route returns normalized parse contract fields", () => {
  const source = read(pdfParseRoutePath);

  assert.match(
    source,
    /parseCoverage:\s*\{/,
    "Expected /api/pdf/parse response payloads to include parseCoverage.",
  );

  assert.match(
    source,
    /verificationSummary:\s*\{/,
    "Expected /api/pdf/parse response payloads to include verificationSummary.",
  );

  assert.match(
    source,
    /parseState:/,
    "Expected /api/pdf/parse response payloads to include parseState.",
  );

  assert.match(
    source,
    /parseReason:/,
    "Expected /api/pdf/parse response payloads to include parseReason.",
  );
});
