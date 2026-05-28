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

function loadExtractSnippetHelpers() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "escapeRegex"),
    extractFunctionSource(scriptSource, "buildFlexibleWordPattern"),
    extractFunctionSource(scriptSource, "buildFlexibleLabelPattern"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "extractSnippet"),
    extractFunctionSource(scriptSource, "extractSnippetFromLabels"),
    "globalThis.__exports = { extractSnippetFromLabels };",
  ];

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("extractSnippetFromLabels matches letter-spaced section labels", () => {
  const { extractSnippetFromLabels } = loadExtractSnippetHelpers();
  const text = [
    "T e a m D y n a m i c s :",
    "F o r m i n g  s t a g e  b e h a v i o r s  a r e  c l e a r  a n d  c o l l a b o r a t i v e.",
    "D e c i s i o n  F r a m e w o r k :",
    "C e n t e r e d  c h o i c e s  i m p r o v e  e x e c u t i o n.",
  ].join(" ");

  const teamSnippet = extractSnippetFromLabels(text, ["Team Dynamics"]);
  const decisionSnippet = extractSnippetFromLabels(text, ["Decision Framework"]);

  assert.match(String(teamSnippet || ""), /forming/i);
  assert.match(String(decisionSnippet || ""), /centered/i);
});
