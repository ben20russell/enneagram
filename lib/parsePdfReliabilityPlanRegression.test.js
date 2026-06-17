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

test("parsePdf performs layout extraction + agentic OCR repair before LLM structuring", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /extractLayoutHtmlWithPython\([\s\S]*?agenticOcrRepair\([\s\S]*?extractAttachedStructuredJson(?:WithTargetedRouting)?\(/,
    "Expected parsePdf to run Stage 1 layout extraction, Stage 2 OCR repair, then Stage 3 JSON structuring.",
  );

  assert.match(
    source,
    /layout_html_python|agentic_ocr_repaired_html/,
    "Expected parsePdf to expose custom extraction method labels for the staged pipeline.",
  );
});

test("parsePdf records staged extraction source in diagnostics", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /extractLayoutHtmlWithPython\(/,
    "Expected parsePdf to call Python layout extraction before downstream JSON extraction.",
  );

  assert.match(
    source,
    /agentic_ocr_repaired_html|layout_html_python|layout_html_override/,
    "Expected parsePdf extraction diagnostics to expose staged extraction source labels.",
  );
});
