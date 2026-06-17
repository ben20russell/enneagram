import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf attachment prompt uses supported file content type for Azure OpenAI payloads", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /type:\s*"file"/,
    "Expected attachment content blocks to use supported type \"file\".",
  );

  assert.doesNotMatch(
    source,
    /type:\s*"input_file"/,
    "Expected parsePdf attachment payload to avoid deprecated/unsupported input_file type.",
  );
});
