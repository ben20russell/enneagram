import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf loader uses dynamic ESM import for pdfjs-dist v4 compatibility", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /pdfjs-dist\/legacy\/build\/pdf\.mjs/,
    "Expected parsePdf loader to target the legacy ESM build path used in pdfjs-dist v4.",
  );

  assert.match(
    source,
    /new Function\(\s*["']specifier["']\s*,\s*["']return import\(specifier\)["']\s*\)/,
    "Expected parsePdf loader to use dynamic import() for ESM compatibility.",
  );

  assert.doesNotMatch(
    source,
    /createRequire\s*\(/,
    "Expected parsePdf loader to avoid createRequire-based CommonJS loading for pdfjs-dist v4.",
  );

  assert.doesNotMatch(
    source,
    /require\(["']pdfjs-dist\/legacy\/build\/pdf\.js["']\)/,
    "Expected parsePdf loader to avoid require('pdfjs-dist/legacy/build/pdf.js') in v4-compatible mode.",
  );
});
