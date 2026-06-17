import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf uses repaired-HTML text handoff to Azure OpenAI and avoids file attachment blocks", () => {
  const source = read(parsePdfPath);

  assert.doesNotMatch(
    source,
    /type:\s*"file"/,
    "Expected parsePdf to avoid file content blocks after migrating to markdown-first parsing.",
  );

  assert.doesNotMatch(
    source,
    /type:\s*"input_file"|file_data:\s*`data:application\/pdf;base64/i,
    "Expected parsePdf to avoid deprecated input_file and legacy file_data attachment payloads.",
  );

  assert.match(
    source,
    /Extract data based on semantic alignment/i,
    "Expected parsePdf to pass repaired HTML text into the LLM prompt body.",
  );
});
