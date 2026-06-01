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

function loadInstinctGoalFns() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "compactInsightSnippet"),
    extractFunctionSource(scriptSource, "escapeRegex"),
    extractFunctionSource(scriptSource, "buildFlexibleWordPattern"),
    extractFunctionSource(scriptSource, "buildFlexibleLabelPattern"),
    extractFunctionSource(scriptSource, "buildFlexiblePhrasePattern"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "extractInstinctGoalDefinitions"),
    extractConstObjectSource(scriptSource, "ASSIGNED_PDF_INSTRUCTION_RULES"),
    "globalThis.__exports = { extractInstinctGoalDefinitions, ASSIGNED_PDF_INSTRUCTION_RULES };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("instinct-goal instruction rules are anchored to page 10 definitions and per-instinct paragraphs", () => {
  const { ASSIGNED_PDF_INSTRUCTION_RULES } = loadInstinctGoalFns();

  assert.equal(
    JSON.stringify(ASSIGNED_PDF_INSTRUCTION_RULES?.instinctGoals?.pageNumbers || []),
    JSON.stringify([10]),
    "Expected instinct-goals extraction to stay anchored on page 10.",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.instinctGoals?.startAnchor,
    "Definitions of the three instinctual goals",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.instinctGoals?.endAnchor,
    "end of page",
  );

  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.instinctGoalOneOnOne?.startAnchor,
    "One-On-One - SX",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.instinctGoalSocial?.startAnchor,
    "Social - SO",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.instinctGoalSelfPres?.startAnchor,
    "Self-Preservation - SP",
  );
});

test("instinct-goal parser extracts SX/SO/SP paragraphs from page-10 definitions copy", () => {
  const { extractInstinctGoalDefinitions } = loadInstinctGoalFns();

  const pageTenText = `
    Definitions of the three instinctual goals
    One-On-One - SX The primary concern for the One-to-One instinct is with intensity of experience,
    focusing attention on the quality and status of relationships with specific people.
    This instinct seeks a sense of well-being through one-to-one connections with people.
    Social - SO The primary concern for the Social instinct is about belonging, recognition,
    and relationships in social groups.
    This instinct focuses on how much power or standing one has relative to other members of the group.
    Self-Preservation - SP The primary concern for the Self-Preservation instinct is survival,
    physical safety, material security, wellbeing and comfort.
    Behaviour is shaped to focus on safety and security concerns, on avoiding danger,
    maintaining a basic sense of structure, and on having enough resources.
  `;

  const goals = extractInstinctGoalDefinitions(pageTenText);

  assert.equal(Boolean(goals), true);
  assert.match(String(goals?.oneOnOne || ""), /intensity of experience/i);
  assert.match(String(goals?.social || ""), /belonging, recognition/i);
  assert.match(String(goals?.selfPres || ""), /survival, physical safety/i);
});

test("spreadsheet focus extraction uses per-instinct paragraph anchors for hydration", () => {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const script = readFileSync(reportScriptPath, "utf8");

  assert.match(
    script,
    /ASSIGNED_PDF_INSTRUCTION_RULES\.instinctGoalOneOnOne/,
    "Expected spreadsheet focus extraction to use anchored One-On-One instinct paragraph rule.",
  );
  assert.match(
    script,
    /ASSIGNED_PDF_INSTRUCTION_RULES\.instinctGoalSocial/,
    "Expected spreadsheet focus extraction to use anchored Social instinct paragraph rule.",
  );
  assert.match(
    script,
    /ASSIGNED_PDF_INSTRUCTION_RULES\.instinctGoalSelfPres/,
    "Expected spreadsheet focus extraction to use anchored Self-Preservation instinct paragraph rule.",
  );
});
