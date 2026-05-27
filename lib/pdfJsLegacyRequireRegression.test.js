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

test("parsePdf uses Azure Document Intelligence client initialization", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /import\s+\{\s*DocumentAnalysisClient,\s*AzureKeyCredential\s*\}\s+from\s+["']@azure\/ai-form-recognizer["']/,
    "Expected parsePdf to import Azure Document Intelligence client types.",
  );

  assert.match(
    source,
    /new\s+DocumentAnalysisClient\s*\(\s*cleanEndpoint\s*,\s*new\s+AzureKeyCredential\s*\(\s*key\s*\)\s*\)/,
    "Expected parsePdf to construct a DocumentAnalysisClient with AzureKeyCredential.",
  );

  assert.match(
    source,
    /Missing Azure Document Intelligence environment variables\./,
    "Expected parsePdf to fail fast when required Document Intelligence env vars are missing.",
  );
});

test("parsePdf calls prebuilt-layout and returns parse status fields", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /beginAnalyzeDocument\s*\(\s*["']prebuilt-layout["']\s*,\s*pdfBuffer\s*,\s*\{[\s\S]*contentType:\s*["']application\/pdf["']/,
    "Expected parsePdf to call Document Intelligence prebuilt-layout analysis with the input buffer.",
  );

  assert.match(
    source,
    /parseStatus:\s*pages\.length\s*>\s*0\s*\?\s*['"]complete['"]\s*:\s*['"]incomplete['"]/,
    "Expected parsePdf success payload to include parseStatus.",
  );

  assert.match(
    source,
    /reviewStatus:\s*['"]ready['"]/,
    "Expected parsePdf success payload to include reviewStatus='ready'.",
  );

  assert.match(
    source,
    /parsePages:\s*pages\.length/,
    "Expected parsePdf success payload to include parsePages from analyzed pages length.",
  );

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
