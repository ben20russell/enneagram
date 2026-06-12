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

function loadConflictTriggerBulletFormatter() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "extractBulletItemsFromText"),
    extractFunctionSource(scriptSource, "extractNarrativeBulletItems"),
    extractFunctionSource(scriptSource, "normalizeNarrativeBulletRows"),
    "globalThis.__exports = { normalizeNarrativeBulletRows };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("conflict triggered bullet formatter splits inline symbol-packed rows into separate bullets", () => {
  const { normalizeNarrativeBulletRows } = loadConflictTriggerBulletFormatter();
  const rows = normalizeNarrativeBulletRows(
    [
      "Your reaction is likely to be strongly driven by an instinctive and even physical response \u25cf Strong feelings of anger that leads to action in some shape or form \u25cf When vulnerable, you may choose to withdraw from the situation entirely or consult with individuals whose opinions you value and trust, using them as sound",
    ],
    16,
  );

  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 3, "Expected a single inline row to split into three bullet lines.");
  assert.doesNotMatch(rows.join(" "), /\u25cf/, "Expected inline black-circle bullet symbols to be removed from render rows.");
  assert.match(String(rows[0] || ""), /reaction is likely to be strongly driven/i);
  assert.match(String(rows[1] || ""), /strong feelings of anger/i);
  assert.match(String(rows[2] || ""), /when vulnerable/i);
});
