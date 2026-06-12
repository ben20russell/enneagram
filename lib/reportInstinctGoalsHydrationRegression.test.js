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
    extractFunctionSource(scriptSource, "isolateInstinctGoalTopicText"),
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

test("instinct-goal parser keeps Social copy isolated when SX heading appears later in the same block", () => {
  const { extractInstinctGoalDefinitions } = loadInstinctGoalFns();

  const reorderedCopy = `
    Social - SO Groups. Behaviour is shaped to "get along with the herd" - with family, community and groups of importance.
    This instinct focuses on how much power or standing one has relative to other members of the group.
    One-On-One - SX The primary concern for the One-to-One instinct is with intensity of experience,
    focusing attention on the quality and status of relationships with specific people.
    Self-Preservation - SP The primary concern for the Self-Preservation instinct is survival, physical safety,
    material security, wellbeing and comfort.
  `;

  const goals = extractInstinctGoalDefinitions(reorderedCopy);
  const social = String(goals?.social || "");
  const oneOnOne = String(goals?.oneOnOne || "");

  assert.match(social, /get along with the herd/i);
  assert.doesNotMatch(
    social,
    /one-on-one|intensity of experience/i,
    "Expected Social goal text to stay isolated from the SX paragraph.",
  );
  assert.match(oneOnOne, /intensity of experience/i);
});

test("instinct-goal parser still extracts Self-Preservation when heading is inline and long text follows", () => {
  const { extractInstinctGoalDefinitions } = loadInstinctGoalFns();

  const longTail = `
    27 Subtypes & Instincts
    We have three basic instinctual drives that are essential for human experience.
    Centers of Expression
    Thinking Center of Expression: MEDIUM
    Action Center of Expression: LOW
  `.repeat(14);

  const inlineHeadingCopy = `
    Definitions of the three instinctual goals
    One-On-One - SX The primary concern for the One-to-One instinct is with intensity of experience and one-to-one connection.
    Social - SO The primary concern for the Social instinct is about belonging, recognition and social standing in groups.
    This instinct focuses on cooperation, participation and reputation in communities.
    Self-Preservation - SPThe primary concern for the Self-Preservation instinct is survival, physical safety,
    material security, wellbeing and comfort. Behaviour is shaped to focus on safety and security concerns,
    avoiding danger, preserving structure and having enough resources for sustainable functioning.
    ${longTail}
  `;

  const goals = extractInstinctGoalDefinitions(inlineHeadingCopy);
  const selfPres = String(goals?.selfPres || "");

  assert.match(
    selfPres,
    /survival,\s*physical safety/i,
    "Expected SP extraction to work when the SP heading is inline with the sentence body.",
  );
  assert.doesNotMatch(
    selfPres,
    /27 Subtypes/i,
    "Expected SP extraction to stop before downstream headings like 27 Subtypes & Instincts.",
  );
  assert.doesNotMatch(
    selfPres,
    /\.\.\.$/,
    "Expected SP extraction to avoid hard truncation ellipsis in hydration copy.",
  );
});

test("instinct-goal parser removes explicit SO/SX spillover from Self-Preservation copy", () => {
  const { extractInstinctGoalDefinitions } = loadInstinctGoalFns();

  const mixedSelfPresCopy = `
    Definitions of the three instinctual goals
    Self-Preservation - SP The primary concern for the Self-Preservation instinct is survival, physical safety,
    practical continuity and managing resources for wellbeing.
    This can be contrasted with Social - SO status concerns and One-On-One - SX intensity priorities.
  `;

  const goals = extractInstinctGoalDefinitions(mixedSelfPresCopy);
  const selfPres = String(goals?.selfPres || "");

  assert.match(selfPres, /survival,\s*physical safety/i);
  assert.doesNotMatch(
    selfPres,
    /Social\s*-\s*SO|One-On-One\s*-\s*SX/i,
    "Expected SP extraction to remove explicit non-SP instinct references.",
  );
});

test("instinct-goal parser keeps Social extraction anchored to the Social - SO heading", () => {
  const { extractInstinctGoalDefinitions } = loadInstinctGoalFns();

  const pageTenWithIntro = `
    The three basic instinctual drives, namely Self-Preservation (physical survival), One-to-One (relationships)
    and Social (communal hierarchy) are ways in which we express ourselves in the world and in human interactions.
    Definitions of the three instinctual goals
    One-On-One - SX The primary concern for the One-to-One instinct is with intensity of experience.
    Social - SO The primary concern for the Social instinct is about belonging, recognition, and relationships in social groups.
    Self-Preservation - SP The primary concern for the Self-Preservation instinct is survival, physical safety and comfort.
  `;

  const goals = extractInstinctGoalDefinitions(pageTenWithIntro);
  const social = String(goals?.social || "");

  assert.match(social, /primary concern for the Social instinct is about belonging/i);
  assert.doesNotMatch(
    social,
    /communal hierarchy/i,
    "Expected Social extraction to ignore pre-heading intro mentions of social instinct.",
  );
  assert.doesNotMatch(
    social,
    /Definitions of the three instinctual goals/i,
    "Expected Social extraction to return the paragraph body, not section heading spillover.",
  );
});

test("instruction extraction engine handles end-of-page anchors and relaxes heading-only matching when needed", () => {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const script = readFileSync(reportScriptPath, "utf8");

  assert.match(
    script,
    /const\s+useEndOfPageBoundary\s*=\s*endAnchor\s*===\s*"end_of_page"/,
    "Expected instruction extraction to explicitly handle end-of-page boundaries.",
  );
  assert.match(
    script,
    /const\s+limitToStartPage\s*=\s*useEndOfPageBoundary\s*&&\s*Boolean\(safeRule\.limitToStartPage\)/,
    "Expected end-of-page narrowing to be opt-in per rule so multi-page sections keep their full context.",
  );
  assert.match(
    script,
    /limitToStartPage\s*\?\s*pageSegments\.slice\(startIndex,\s*startIndex\s*\+\s*1\)/,
    "Expected per-rule end-of-page extraction to stay scoped to one page when explicitly requested.",
  );
  assert.match(
    script,
    /instinctGoalSelfPres[\s\S]*limitToStartPage:\s*true/s,
    "Expected SP instinct extraction rule to opt into single-page end-of-page boundaries.",
  );
  assert.match(
    script,
    /if\s*\(!startMatch\s*&&\s*Boolean\(safeRule\.preferHeadingStart\)\)\s*\{[\s\S]*preferHeading:\s*false/s,
    "Expected instruction extraction to retry anchor matching without heading-only constraints.",
  );
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
