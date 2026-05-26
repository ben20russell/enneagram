import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf loader prefers legacy CommonJS pdfjs-dist path for compatibility", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /createRequire\s*\(\s*import\.meta\.url\s*\)/,
    "Expected parsePdf loader to initialize Node createRequire for CommonJS fallback loading.",
  );

  assert.match(
    source,
    /require\(["']pdfjs-dist\/legacy\/build\/pdf\.js["']\)/,
    "Expected parsePdf loader to define the legacy CommonJS pdfjs-dist path for compatibility.",
  );

  assert.match(
    source,
    /nodeRequire\s*\(\s*getLegacyPdfJsCjsPath\(\)\s*\)/,
    "Expected parsePdf loader to use createRequire with the configured legacy CommonJS pdfjs-dist path.",
  );
});
