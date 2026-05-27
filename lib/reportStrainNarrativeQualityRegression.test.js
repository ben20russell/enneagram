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
  const openBrace = source.indexOf("{", start);
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

function loadStrainNarrativeFunctions() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "isMissingExtractedText"),
    extractFunctionSource(scriptSource, "isLowQualityStrainNarrative"),
    extractFunctionSource(scriptSource, "mergeCategoryWriteups"),
    "globalThis.__exports = { isLowQualityStrainNarrative, mergeCategoryWriteups };",
  ];

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("strain narrative quality detector rejects label-chain artifacts", () => {
  const { isLowQualityStrainNarrative } = loadStrainNarrativeFunctions();
  assert.equal(
    isLowQualityStrainNarrative("STRAIN LOW OVERALL STRAIN LEVEL MEDIUM", "Environmental"),
    true,
  );
});

test("strain narrative quality detector keeps full sentence narratives", () => {
  const { isLowQualityStrainNarrative } = loadStrainNarrativeFunctions();
  assert.equal(
    isLowQualityStrainNarrative(
      "Psychological strain is LOW. You experience yourself as able to cope with your present circumstances and do not feel emotionally overwhelmed.",
      "Psychological",
    ),
    false,
  );
});

test("mergeCategoryWriteups prefers fallback narrative over low-quality primary text", () => {
  const { mergeCategoryWriteups } = loadStrainNarrativeFunctions();
  const merged = mergeCategoryWriteups(
    [{ category: "Environmental", text: "STRAIN LOW OVERALL STRAIN LEVEL MEDIUM" }],
    [{ category: "Environmental", text: "Environmental strain is LOW. You feel relatively steady in your current external context." }],
    ["Environmental"],
  );

  assert.equal(merged.length, 1);
  assert.match(String(merged[0]?.text || ""), /steady in your current external context/i);
});

