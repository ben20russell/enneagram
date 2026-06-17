import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reparseScriptPath = path.join(repoRoot, "scripts", "reparse-assigned-report.mjs");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("reparse-assigned-report script runs local OCR-aware extraction before parsePdf", () => {
  const source = read(reparseScriptPath);

  assert.match(
    source,
    /extract_pdf_pages\.py/,
    "Expected reparse script to invoke the local OCR-aware page extraction script.",
  );

  assert.match(
    source,
    /rawTextOverride/,
    "Expected reparse script to construct a rawTextOverride payload for parsePdf.",
  );
});

test("reparse-assigned-report parse call passes rawTextOverride and pageCountOverride when available", () => {
  const source = read(reparseScriptPath);

  assert.match(
    source,
    /parsePdf\(\s*pdfBuffer\s*,\s*\{[\s\S]*rawTextOverride[\s\S]*pageCountOverride[\s\S]*pagesOverride[\s\S]*\}\s*\)/,
    "Expected reparse script parse options to include rawTextOverride, pageCountOverride, and pagesOverride.",
  );
});

test("reparse-assigned-report builds extraction-learning context and passes it into parsePdf", () => {
  const source = read(reparseScriptPath);

  assert.match(
    source,
    /buildMlExtractionLearningContext\(\s*\{[\s\S]*supabase[\s\S]*table[\s\S]*reportId:\s*report\.id[\s\S]*\}\s*\)/,
    "Expected reparse script to build extraction-learning context from existing report rows.",
  );

  assert.match(
    source,
    /parsePdf\(\s*pdfBuffer\s*,\s*\{[\s\S]*extractionLearningContext[\s\S]*\}\s*\)/,
    "Expected reparse script parse options to include extractionLearningContext.",
  );
});

test("reparse-assigned-report applies ML score learning before persisting parsed profile", () => {
  const source = read(reparseScriptPath);

  assert.match(
    source,
    /applyMlScoreLearningToParsedProfile\(\s*\{[\s\S]*supabase[\s\S]*table[\s\S]*parsedProfile[\s\S]*reportId:\s*report\.id[\s\S]*\}\s*\)/,
    "Expected reparse script to run ML score learning with the parsed profile before save.",
  );

  assert.match(
    source,
    /parsedProfile:\s*parsedForSave/,
    "Expected reparse persistence payload to store the ML-adjusted parsed profile.",
  );
});

test("reparse-assigned-report exits on parser failed state by default", () => {
  const source = read(reparseScriptPath);

  assert.match(
    source,
    /failOnParserFailure/,
    "Expected reparse script to define a parser-failure hard-fail toggle.",
  );

  assert.match(
    source,
    /if\s*\(\s*failOnParserFailure\s*&&\s*parseState\s*===\s*["']failed["']\s*\)\s*\{[\s\S]*throw new Error\(/,
    "Expected reparse script to throw when parsePdf returns failed state.",
  );
});

test("reparse-assigned-report completeness is based on core identity + page coverage + verification consistency", () => {
  const source = read(reparseScriptPath);

  assert.match(
    source,
    /const\s+hasCoreIdentity\s*=\s*Boolean\(\s*parsed\?\.(?:primaryType|typeName)[\s\S]*\)/,
    "Expected reparse script completeness check to include core identity presence.",
  );

  assert.match(
    source,
    /const\s+isComplete\s*=\s*hasMinPages\s*&&\s*hasCoreIdentity\s*&&\s*hasVerificationConsistency\s*;/,
    "Expected reparse completeness to avoid hard dependency on full chart score availability.",
  );
});
