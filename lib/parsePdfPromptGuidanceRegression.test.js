import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("parsePdf LLM prompt includes explicit iEQ9 section/page extraction guidance", () => {
  const source = read(parsePdfPath);

  assert.match(
    source,
    /Act like an enneagram expert and identify and parse the following sections/i,
    "Expected parsePdf prompt to include the explicit section guidance preface.",
  );

  assert.match(
    source,
    /Core Enneagram Type:\s*page 8/i,
    "Expected prompt guidance to include the core type page anchor.",
  );

  assert.match(
    source,
    /27 Subtypes & Instincts:\s*page 10/i,
    "Expected prompt guidance to include subtype page anchors.",
  );

  assert.match(
    source,
    /Centers of Expression:\s*page 12 and 13/i,
    "Expected prompt guidance to include centers page anchors.",
  );

  assert.match(
    source,
    /Self-Awareness & Integration:\s*page 16 and 17/i,
    "Expected prompt guidance to include integration page anchors.",
  );

  assert.match(
    source,
    /Feedback Guide:\s*page 28 and 29/i,
    "Expected prompt guidance to include feedback guide page anchors.",
  );
});
