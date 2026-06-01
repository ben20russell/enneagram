import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function in dashboard script: ${functionName}`);
  }
  const signatureEnd = source.indexOf(")", start);
  const openBrace = source.indexOf("{", signatureEnd);
  if (openBrace === -1) {
    throw new Error(`Could not parse function in dashboard script: ${functionName}`);
  }
  let depth = 0;
  for (let idx = openBrace; idx < source.length; idx += 1) {
    const char = source[idx];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, idx + 1);
      }
    }
  }
  throw new Error(`Unbalanced braces while parsing function: ${functionName}`);
}

function loadNarrativeSplitFns() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "extractBulletItemsFromText"),
    extractFunctionSource(scriptSource, "extractNarrativeBulletItems"),
    "globalThis.__exports = { extractNarrativeBulletItems };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("narrative bullet extractor splits run-on multi-sentence paragraphs into separate bullets", () => {
  const { extractNarrativeBulletItems } = loadNarrativeSplitFns();
  const source = `
    You are still deciding whether to commit to the team or not
    Make quite a strong impact on others that don't know you well, which may be either positive or negative
    Not be restrained by small-talk and social niceties too much, still preferring to say things as it is.
  `;

  const rows = extractNarrativeBulletItems(source, 8);

  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length >= 3, true, "Expected at least three bullet rows after split.");
  assert.match(String(rows[0] || ""), /deciding whether to commit/i);
  assert.match(String(rows[1] || ""), /make quite a strong impact/i);
  assert.match(String(rows[2] || ""), /not be restrained by small-talk/i);
});

test("narrative bullet extractor keeps single-sentence paragraphs as one bullet", () => {
  const { extractNarrativeBulletItems } = loadNarrativeSplitFns();
  const source =
    "You are likely to be quite aware of interdependencies in a team setting that leave you at the mercy of others competence in task completion.";

  const rows = extractNarrativeBulletItems(source, 8);

  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 1);
  assert.match(String(rows[0] || ""), /aware of interdependencies/i);
});
