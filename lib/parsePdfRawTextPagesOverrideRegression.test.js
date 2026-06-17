import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf supports pagesOverride to keep per-page text when rawTextOverride is used", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /function\s+normalizePagesOverride\s*\(/,
    "Expected parsePdf to define pagesOverride normalization helper.",
  );

  assert.match(
    source,
    /const\s+pagesOverride\s*=\s*normalizePagesOverride\(\s*parseOptions\?\.pagesOverride\s*\)\s*;/,
    "Expected parsePdf to read pagesOverride from parse options.",
  );

  assert.match(
    source,
    /extractedPages\s*=\s*hasPagesOverrideText\s*\?\s*pagesOverride\s*:\s*buildOverridePages\(/,
    "Expected rawTextOverride flow to prefer pagesOverride over single-page synthetic override pages.",
  );
});
