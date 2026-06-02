import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const parsePdfPath = path.join(repoRoot, "lib", "parsePdf.js");

function readParsePdf() {
  return fs.readFileSync(parsePdfPath, "utf8");
}

test("parsePdf no longer carries targeted strain anchor extraction helpers", () => {
  const source = readParsePdf();

  assert.doesNotMatch(
    source,
    /buildTargetedStrainInterpretationTextByName|TARGETED_STRAIN_INTERPRETATION_RULES|startAnchor|endAnchor/i,
    "Expected old targeted strain anchor parsing logic to be removed.",
  );
});

test("parsePdf maps attached strain_profile into compatibility strain fields", () => {
  const source = readParsePdf();

  assert.match(
    source,
    /strain_profile/,
    "Expected attached schema strain_profile handling in parsePdf.",
  );

  assert.match(
    source,
    /strainLevels|strain_levels|strain_scores/,
    "Expected parsePdf to expose compatibility strain level/score fields for UI hydration.",
  );
});
