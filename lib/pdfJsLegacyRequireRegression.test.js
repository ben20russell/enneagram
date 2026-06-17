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

test("parsePdf uses Azure Document Intelligence markdown pre-processing and text-only LLM parsing", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /@azure-rest\/ai-document-intelligence|extractMarkdownWithAzureDocIntel|outputContentFormat:\s*["']markdown["']|prebuilt-layout/i,
    "Expected parsePdf to extract markdown with Azure Document Intelligence before LLM parsing.",
  );

  assert.match(
    source,
    /extract_pdf_pages\.py|extractPdfPagesWithPython/i,
    "Expected parsePdf to keep python extraction utilities for verification and resilience workflows.",
  );

  assert.doesNotMatch(
    source,
    /file_data:\s*`data:application\/pdf;base64|type:\s*["']file["']/i,
    "Expected parsePdf to avoid direct PDF file attachment blocks in Azure OpenAI request payloads.",
  );

  assert.match(
    source,
    /attached-agentic-ocr-v1|attached-single-pass-v2|attached-llm-only-v1/,
    "Expected parsePdf diagnostics to identify the LLM-only parser version.",
  );
});

test("parsePdf keeps diagnostics payload with incompleteReason on fatal errors", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /_parseDiagnostics:\s*\{\s*isComplete:\s*false[\s\S]*incompleteReason:\s*parseReason/,
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
