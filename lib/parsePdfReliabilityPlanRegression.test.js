import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf uses strict JSON schema response formatting for LLM extraction", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /response_format:\s*\{\s*type:\s*["']json_schema["']/,
    "Expected parsePdf to request structured output via json_schema response format.",
  );

  assert.match(
    source,
    /strict:\s*true/,
    "Expected parsePdf JSON schema response format to run in strict mode.",
  );
});

test("parsePdf emits explicit Azure preflight diagnostics and failed parse state when env is missing", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /Missing Azure environment variables:/,
    "Expected parsePdf to include explicit missing-env diagnostics in parse reason output.",
  );

  assert.match(
    source,
    /_parseState:\s*["']failed["']/,
    "Expected parsePdf to emit an explicit failed parse state on fatal preflight failure.",
  );
});

test("parsePdf failure diagnostics always include verification payload", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /_parseDiagnostics:\s*\{[\s\S]*verification:\s*\{/,
    "Expected parsePdf failure diagnostics to always include verification metadata.",
  );
});

test("parsePdf stores field-level page provenance for hydration checks", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /fieldPageProvenance|pageProvenance/,
    "Expected parsePdf to store field-level page provenance in parsed output or diagnostics.",
  );
});

test("parsePdf prompt instructs LLM to repair OCR letter-spacing and split words", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /OCR|split words|letter[-\s]?spacing/i,
    "Expected parsePdf prompt guidance to normalize OCR spacing artifacts before returning JSON.",
  );
});

test("parsePdf performs markdown extraction with LlamaParse before LLM parsing", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /extractTextWithLlamaParse\(pdfBuffer\)[\s\S]*?rawText:\s*llamaParseMarkdown/,
    "Expected parsePdf to route PDF bytes through LlamaParse and then parse markdown text with the LLM.",
  );

  assert.match(
    source,
    /LLAMA_CLOUD_API_KEY/,
    "Expected parsePdf to enforce Llama Cloud env vars in preflight diagnostics.",
  );
});

test("parsePdf records LlamaParse markdown extraction source in diagnostics", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /extractTextWithLlamaParse\(pdfBuffer\)/,
    "Expected parsePdf to call LlamaParse before downstream JSON extraction.",
  );

  assert.match(
    source,
    /llamaparse_markdown/,
    "Expected parsePdf extraction diagnostics to expose LlamaParse extraction source.",
  );
});
