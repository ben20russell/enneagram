import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");
const nextConfigPath = path.join(repoRoot, "next.config.mjs");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf strips old Document Intelligence pipeline and uses LLM-only parsing", () => {
  const source = read(parsePdfPath);

  assert.doesNotMatch(
    source,
    /@azure\/ai-form-recognizer|DocumentAnalysisClient|AzureKeyCredential|beginAnalyzeDocument/i,
    "Expected parsePdf to remove Azure Document Intelligence parsing path entirely.",
  );

  assert.doesNotMatch(
    source,
    /extract_pdf_pages\.py|python3|extractPdfPagesWithPython|execFileAsync/i,
    "Expected parsePdf to avoid local Python parsing and rely on the Azure OpenAI LLM path.",
  );

  assert.match(
    source,
    /input_file|file_data|application\/pdf|responses/i,
    "Expected parsePdf to send the PDF directly to Azure OpenAI for LLM parsing.",
  );

  assert.match(
    source,
    /attached-single-pass-v2|attached-llm-only-v1/,
    "Expected parsePdf diagnostics to identify the LLM-only parser version.",
  );
});

test("parsePdf keeps diagnostics payload with incompleteReason on fatal errors", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /_parseDiagnostics:\s*\{\s*isComplete:\s*false[\s\S]*incompleteReason:\s*error\.message/,
    "Expected parsePdf error payload to include _parseDiagnostics with incompleteReason.",
  );
});

test("next config keeps native canvas package externalized for server runtime bundling", () => {
  const source = read(nextConfigPath);

  assert.match(
    source,
    /serverExternalPackages\s*:\s*\[[^\]]*["@']@napi-rs\/canvas["@']/,
    "Expected next config to mark @napi-rs/canvas as a server external package.",
  );

  assert.match(
    source,
    /serverExternalPackages\s*:\s*\[[^\]]*["@']pdfjs-dist["@']/,
    "Expected next config to mark pdfjs-dist as a server external package.",
  );
});
