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

function extractConstObjectSource(source, constName) {
  const startToken = `const ${constName} =`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing const object in dashboard script: ${constName}`);
  }
  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) {
    throw new Error(`Could not parse const object in dashboard script: ${constName}`);
  }
  let depth = 0;
  for (let idx = openBrace; idx < source.length; idx += 1) {
    const char = source[idx];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const semicolon = source.indexOf(";", idx);
        if (semicolon === -1) {
          throw new Error(`Missing semicolon while parsing const object: ${constName}`);
        }
        return source.slice(start, semicolon + 1);
      }
    }
  }
  throw new Error(`Unbalanced braces while parsing const object: ${constName}`);
}

function loadMotivationHydrationFns() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "extractMotivationalNeedSummary"),
    extractFunctionSource(scriptSource, "firstPresentSnippet"),
    extractFunctionSource(scriptSource, "isMissingExtractedText"),
    extractFunctionSource(scriptSource, "isolateInstinctGoalTopicText"),
    extractFunctionSource(scriptSource, "mergeSpreadsheetSectionFocuses"),
    extractConstObjectSource(scriptSource, "ASSIGNED_PDF_INSTRUCTION_RULES"),
    "globalThis.__exports = { extractMotivationalNeedSummary, mergeSpreadsheetSectionFocuses, ASSIGNED_PDF_INSTRUCTION_RULES, __scriptSource: sourceText };",
  ];
  const context = { globalThis: {}, sourceText: scriptSource };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("motivation instruction-rule remains anchored to page 6", () => {
  const { ASSIGNED_PDF_INSTRUCTION_RULES } = loadMotivationHydrationFns();

  assert.equal(
    JSON.stringify(ASSIGNED_PDF_INSTRUCTION_RULES?.motivationSummary?.pageNumbers || []),
    JSON.stringify([6]),
    "Expected Motivation extraction to remain anchored to page 6.",
  );
  assert.equal(ASSIGNED_PDF_INSTRUCTION_RULES?.motivationSummary?.startAnchor, "Motivation");
  assert.equal(ASSIGNED_PDF_INSTRUCTION_RULES?.motivationSummary?.endAnchor, "Typical Action Patterns");
});

test("spreadsheet focus merge prefers hydrated motivation text over fallback placeholders", () => {
  const { mergeSpreadsheetSectionFocuses } = loadMotivationHydrationFns();

  const earlyMergeValue = {
    motivationSummary: "Not detected in assigned PDF.",
    instinctGoals: {
      selfPres: "Not detected in assigned PDF.",
      social: "Not detected in assigned PDF.",
      oneOnOne: "Not detected in assigned PDF.",
    },
    bodyLanguageRows: ["Not detected in assigned PDF."],
  };

  const pageSixHydrationValue = {
    motivationSummary: "You are motivated by autonomy, impact, and protecting what matters most.",
    instinctGoals: {
      selfPres: "You prioritize security and practical continuity.",
      social: "You prioritize influence and contribution in groups.",
      oneOnOne: "You prioritize intensity and strong relational bonds.",
    },
    bodyLanguageRows: ["You maintain steady eye contact when emphasizing priorities."],
  };

  const merged = mergeSpreadsheetSectionFocuses(earlyMergeValue, pageSixHydrationValue);

  assert.match(String(merged?.motivationSummary || ""), /motivated by autonomy, impact/i);
  assert.doesNotMatch(String(merged?.motivationSummary || ""), /not detected in assigned pdf/i);
  assert.match(String(merged?.instinctGoals?.social || ""), /influence and contribution/i);
  assert.equal(Array.isArray(merged?.bodyLanguageRows), true);
  assert.match(String((merged?.bodyLanguageRows || []).join(" ")), /steady eye contact/i);
});

test("spreadsheet focus merge rejects instinct-goal spillover and prefers isolated fallback copy", () => {
  const { mergeSpreadsheetSectionFocuses } = loadMotivationHydrationFns();

  const contaminatedPreferred = {
    instinctGoals: {
      selfPres:
        "The focus is safety and material continuity. This can be contrasted with Social - SO status concerns and One-On-One - SX intensity priorities.",
      social: "The focus is belonging, recognition, and contribution in groups.",
      oneOnOne: "The focus is intensity, chemistry, and depth in close bonds.",
    },
  };

  const isolatedFallback = {
    instinctGoals: {
      selfPres: "The focus is safety, material continuity, and practical wellbeing.",
      social: "The focus is belonging, recognition, and contribution in groups.",
      oneOnOne: "The focus is intensity, chemistry, and depth in close bonds.",
    },
  };

  const merged = mergeSpreadsheetSectionFocuses(contaminatedPreferred, isolatedFallback);
  const selfPres = String(merged?.instinctGoals?.selfPres || "");

  assert.match(selfPres, /safety(?:\s+and|,\s*)\s*material continuity/i);
  assert.doesNotMatch(
    selfPres,
    /Social\s*-\s*SO|One-On-One\s*-\s*SX/i,
    "Expected merged SP instinct-goal copy to exclude explicit non-SP instinct references.",
  );
});

test("motivational need extraction prefers page 6 bold motivational-need sentence", () => {
  const { extractMotivationalNeedSummary } = loadMotivationHydrationFns();

  const pageSixText = `
    Motivation
    This style stems from the motivational need to be unique and authentic. As an Ennea 4 you are likely to value your individualism.
    Typical Action Patterns
  `;

  const extracted = extractMotivationalNeedSummary(pageSixText);
  assert.match(String(extracted || ""), /motivational need to be unique and authentic/i);
  assert.doesNotMatch(String(extracted || ""), /Typical Action Patterns/i);
});

test("structured motivation hydration path prioritizes motivational-need extraction", () => {
  const { __scriptSource } = loadMotivationHydrationFns();

  assert.match(
    String(__scriptSource || ""),
    /motivationSummary:\s*extractMotivationalNeedSummary\([\s\S]*?\)\s*\|\|\s*extractSpreadsheetSnippetFromText\(/,
    "Expected spreadsheet motivation hydration to prioritize motivational-need extraction before generic label snippets.",
  );
});
