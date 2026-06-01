import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function readParsePdf() {
  return fs.readFileSync(parsePdfPath, "utf8");
}

test("parsePdf targeted strain interpretation uses anchored category snippets instead of a broad section block", () => {
  const source = readParsePdf();

  assert.match(
    source,
    /function\s+buildTargetedStrainInterpretationTextByName\s*\(/,
    "Expected parsePdf to define a dedicated builder for per-category strain interpretation extraction.",
  );

  assert.match(
    source,
    /if\s*\(\s*sectionName\s*===\s*["']strain_interpretation["']\s*\)\s*\{[\s\S]*buildTargetedStrainInterpretationTextByName/i,
    "Expected targeted section assembly to use anchored category extraction for strain_interpretation.",
  );
});

test("parsePdf targeted strain interpretation anchors Environmental and Happiness to requested page boundaries", () => {
  const source = readParsePdf();

  assert.match(
    source,
    /environmental\s*:\s*\{[\s\S]*pageNumbers\s*:\s*\[\s*20\s*\][\s\S]*startAnchor\s*:\s*["']Ben your perceived level of Environmental strain["'][\s\S]*endAnchor\s*:\s*["']Ben your perceived level of Vocational strain["']/i,
    "Expected parsePdf targeted Environmental strain extraction to use page 20 and requested anchors.",
  );

  assert.match(
    source,
    /happiness\s*:\s*\{[\s\S]*pageNumbers\s*:\s*\[\s*22\s*\][\s\S]*startAnchor\s*:\s*["']Ben your perceived level of Happiness strain["'][\s\S]*endAnchor\s*:\s*["']end of page["']/i,
    "Expected parsePdf targeted Happiness strain extraction to use page 22 and end-of-page boundary.",
  );
});
