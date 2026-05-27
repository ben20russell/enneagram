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

test("parsePdf configures pdfjs worker-free mode for serverless/node execution", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /GlobalWorkerOptions\.workerPort\s*=\s*null/,
    "Expected parsePdf to explicitly null GlobalWorkerOptions.workerPort for serverless-safe fake-worker avoidance.",
  );

  assert.match(
    source,
    /GlobalWorkerOptions\.workerSrc\s*=\s*["']data:text\/javascript,["']/,
    "Expected parsePdf to set a dummy GlobalWorkerOptions.workerSrc data URI for serverless-safe fake-worker avoidance.",
  );

  assert.match(
    source,
    /disableWorker:\s*true/,
    "Expected parsePdf getDocument calls to keep disableWorker enabled.",
  );

  assert.match(
    source,
    /isEvalSupported:\s*false/,
    "Expected parsePdf getDocument calls to disable eval in serverless runtime.",
  );

  assert.match(
    source,
    /useSystemFonts:\s*true/,
    "Expected parsePdf getDocument calls to enable useSystemFonts in serverless runtime.",
  );
});

test("next config keeps native canvas package externalized for server runtime bundling", () => {
  const source = read(nextConfigPath);

  assert.match(
    source,
    /serverExternalPackages\s*:\s*\[[^\]]*["@']@napi-rs\/canvas["@']/,
    "Expected next config to mark @napi-rs/canvas as a server external package.",
  );
});
