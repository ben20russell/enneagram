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

function loadInstructionRuleExtractors() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "isMissingExtractedText"),
    extractFunctionSource(scriptSource, "normalizeCriticalConflictRows"),
    extractFunctionSource(scriptSource, "escapeRegex"),
    extractFunctionSource(scriptSource, "buildFlexibleWordPattern"),
    extractFunctionSource(scriptSource, "buildFlexibleLabelPattern"),
    extractFunctionSource(scriptSource, "extractBulletItemsFromText"),
    extractFunctionSource(scriptSource, "getReportContentPages"),
    extractConstObjectSource(scriptSource, "ASSIGNED_PDF_INSTRUCTION_RULES"),
    extractFunctionSource(scriptSource, "getReportPageTextByNumber"),
    "const INSTRUCTION_EXTRACTION_ENGINE_CACHE = new WeakMap();",
    extractFunctionSource(scriptSource, "createInstructionExtractionEngine"),
    extractFunctionSource(scriptSource, "getInstructionExtractionEngine"),
    extractFunctionSource(scriptSource, "normalizeInstructionAnchor"),
    extractFunctionSource(scriptSource, "resolveInstructionPageCandidates"),
    extractFunctionSource(scriptSource, "findInstructionAnchorMatch"),
    extractFunctionSource(scriptSource, "extractInstructionTextFromReportContent"),
    extractFunctionSource(scriptSource, "extractInstructionBulletRowsFromReportContent"),
    extractFunctionSource(scriptSource, "resolveConflictPatternsFromSource"),
    "globalThis.__exports = { ASSIGNED_PDF_INSTRUCTION_RULES, extractInstructionTextFromReportContent, extractInstructionBulletRowsFromReportContent, resolveConflictPatternsFromSource };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("instruction-rule extraction tolerates page drift and extracts Environmental Strain from nearby page", () => {
  const { ASSIGNED_PDF_INSTRUCTION_RULES, extractInstructionTextFromReportContent } = loadInstructionRuleExtractors();
  const parsedProfile = {
    reportContent: {
      pages: [
        { pageNumber: 19, extractedText: "Development Exercise placeholder text only." },
        {
          pageNumber: 20,
          extractedText: `
            Ben your perceived level of Environmental strain is LOW.
            ● You feel connected and quite positive about your environment and community.
            ● You feel safe in your neighbourhood and home.
            Ben your perceived level of Vocational strain is MEDIUM.
          `,
        },
      ],
    },
  };
  const extracted = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.environmentalStrain,
    { includeStartAnchor: true },
  );

  assert.doesNotMatch(String(extracted || ""), /vocational strain is medium/i);
  assert.match(String(extracted || ""), /feel safe in your neighbourhood/i);
});

test("instruction extraction flow uses a shared dashboard-wide engine", () => {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const source = readFileSync(reportScriptPath, "utf8");

  assert.match(
    source,
    /const\s+INSTRUCTION_EXTRACTION_ENGINE_CACHE\s*=\s*new\s+WeakMap\(\)/,
    "Expected report script to define a shared instruction extraction engine cache.",
  );
  assert.match(
    source,
    /function\s+createInstructionExtractionEngine\s*\(/,
    "Expected report script to define a shared instruction extraction engine factory.",
  );
  assert.match(
    source,
    /function\s+getInstructionExtractionEngine\s*\(/,
    "Expected report script to expose a shared instruction extraction engine accessor.",
  );
  assert.match(
    source,
    /const\s+instructionEngine\s*=\s*getInstructionExtractionEngine\(parsedProfile\)/,
    "Expected instruction text extraction helper to route through the shared engine.",
  );
});

test("instruction-rule anchors pin Environmental and Happiness strain to exact pages and boundaries", () => {
  const { ASSIGNED_PDF_INSTRUCTION_RULES } = loadInstructionRuleExtractors();

  assert.equal(
    JSON.stringify(ASSIGNED_PDF_INSTRUCTION_RULES?.environmentalStrain?.pageNumbers || []),
    JSON.stringify([20]),
    "Expected Environmental strain extraction to map to page 20 only.",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.environmentalStrain?.startAnchor,
    "Ben your perceived level of Environmental strain",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.environmentalStrain?.endAnchor,
    "Ben your perceived level of Vocational strain",
  );

  assert.equal(
    JSON.stringify(ASSIGNED_PDF_INSTRUCTION_RULES?.happinessStrain?.pageNumbers || []),
    JSON.stringify([22]),
    "Expected Happiness strain extraction to map to page 22 only.",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.happinessStrain?.startAnchor,
    "Ben your perceived level of Happiness strain",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.happinessStrain?.endAnchor,
    "end of page",
  );

  assert.equal(
    JSON.stringify(ASSIGNED_PDF_INSTRUCTION_RULES?.overallStrainSignal?.pageNumbers || []),
    JSON.stringify([18]),
    "Expected Overall strain signal extraction to map to page 18 only.",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.overallStrainSignal?.startAnchor,
    "Your strain profile provides",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.overallStrainSignal?.endAnchor,
    "Ben your perceived level of Vocational strain",
  );
});

test("instruction-rule extraction avoids cross-page false positives for conflict response anchors", () => {
  const { ASSIGNED_PDF_INSTRUCTION_RULES, extractInstructionTextFromReportContent } = loadInstructionRuleExtractors();
  const parsedProfile = {
    reportContent: {
      pages: [
        {
          pageNumber: 28,
          extractedText: `
            Feedback Guide
            The Ennea 1 is exceptionally self-critical in feedback sessions.
            ● Start with a positive note and appreciation.
            ● Keep examples specific and concrete.
          `,
        },
        {
          pageNumber: 30,
          extractedText: `
            The Ennea 8 Response to Conflict
            ● You are likely to actively share your thoughts and feelings.
            ● You will tend to first express emotions before moving in on relationships.
            What triggers you
            ● Injustice and unfairness in general.
          `,
        },
      ],
    },
  };

  const extracted = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.responseToConflict,
    { includeStartAnchor: true },
  );

  assert.match(String(extracted || ""), /actively share your thoughts and feelings/i);
  assert.doesNotMatch(String(extracted || ""), /feedback guide|self-critical/i);
});

test("instruction-rule extraction prefers heading occurrence for trigger anchors", () => {
  const { ASSIGNED_PDF_INSTRUCTION_RULES, extractInstructionTextFromReportContent } = loadInstructionRuleExtractors();
  const parsedProfile = {
    reportContent: {
      pages: [
        {
          pageNumber: 30,
          extractedText: `
            During coaching review we ask what triggers you in difficult moments.
            What triggers you
            ● They challenge your authority.
            ● They slow momentum.
            What you do when triggered
            ● Escalate intensity immediately.
          `,
        },
      ],
    },
  };

  const extracted = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.conflictTriggersBullets,
    { includeStartAnchor: true },
  );

  assert.doesNotMatch(String(extracted || ""), /coaching review/i);
  assert.match(String(extracted || ""), /challenge your authority/i);
  assert.doesNotMatch(String(extracted || ""), /escalate intensity immediately/i);
});

test("instruction-rule extraction isolates the 'what you do when triggered' subsection", () => {
  const { ASSIGNED_PDF_INSTRUCTION_RULES, extractInstructionTextFromReportContent } = loadInstructionRuleExtractors();
  const parsedProfile = {
    reportContent: {
      pages: [
        {
          pageNumber: 30,
          extractedText: `
            What triggers you
            ● They challenge your authority.
            ● They slow momentum.
          `,
        },
        {
          pageNumber: 31,
          extractedText: `
            What you do when triggered
            ● Escalate intensity immediately.
            ● Move fast to reclaim control.
            What others should do
            ● Stay direct and honest.
          `,
        },
      ],
    },
  };

  const extracted = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.whatYouDoWhenTriggered,
    { includeStartAnchor: true },
  );

  assert.match(String(extracted || ""), /escalate intensity immediately/i);
  assert.doesNotMatch(String(extracted || ""), /challenge your authority/i);
  assert.doesNotMatch(String(extracted || ""), /stay direct and honest/i);
});

test("instruction-rule bullet extraction returns body language bullets from explicit page mapping", () => {
  const { ASSIGNED_PDF_INSTRUCTION_RULES, extractInstructionBulletRowsFromReportContent } = loadInstructionRuleExtractors();
  const parsedProfile = {
    reportContent: {
      pages: [
        {
          pageNumber: 25,
          extractedText: `
            Body Language
            ● Maintains direct eye contact when emphasizing key points.
            ● Uses a deliberate and controlled speaking tone.
            ● Leans forward to signal engagement.
          `,
        },
      ],
    },
  };

  const rows = extractInstructionBulletRowsFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.bodyLanguageRows,
    6,
  );

  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length >= 2, true);
  assert.match(String(rows.join(" ")), /direct eye contact/i);
  assert.match(String(rows.join(" ")), /controlled speaking tone/i);
});

const conflictResponseFromPdf = "You are likely to actively share your thoughts and feelings with others and, in conflict situations this may take the form of strong, even explosive reactions";
const vulnerablePatternFromPdf = "When vulnerable, you may choose to withdraw from the situation entirely or consult with individuals whose opinions you value and trust, using them as sounding boards";

function conflictSourceProfile(pageOffset = 0) {
  return {
    reportContent: {
      pages: [
        {
          pageNumber: 30 + pageOffset,
          extractedText: `
            The Ennea 8 Response to Conflict
            When conflict erupts and you are not in a position to avoid it any longer, your Ennea style as a Active Controller islikely to lead to the following reactions and behaviours:
            ● You are likely to actively share your thoughts and feelings with others and, in conflict situations this may take
            the form of strong, even explosive reactions
            ● You will tend to first want to express your emotions before moving in on the relationships
            ● You may deny that you need support and understanding from others in this process
            Your preferred conflict processing strategy is reactive.
            What triggers you
            ● Others attempt to control or overpower you.
          `,
        },
        {
          pageNumber: 31 + pageOffset,
          extractedText: `
            What you do when triggered
            ● Your reaction is likely to be strongly driven by an instinctive and even physical response
            ● Strong feelings of anger that leads to action in some shape or form
            ● When vulnerable, you may choose to withdraw from the situation entirely or consult with individuals whose
            opinions you value and trust, using them as sounding boards
            ● Your response may seem quite intimidating and aggressive to others, even if this is not the case
            Development goals
            ● You can build trust by acknowledging your vulnerability to others.
            ● Express your anger directly while considering its effect on others.
          `,
        },
      ],
    },
  };
}

test("conflict source resolver keeps actual response bullets and removes PDF introductions and strategy metadata", () => {
  const { resolveConflictPatternsFromSource } = loadInstructionRuleExtractors();
  const resolved = resolveConflictPatternsFromSource(conflictSourceProfile());

  assert.match(resolved.conflictResponseCopy, /actively share your thoughts and feelings/);
  assert.ok(resolved.conflictResponseCopy.includes(conflictResponseFromPdf));
  assert.match(resolved.conflictResponseCopy, /deny that you need support and understanding/);
  assert.doesNotMatch(resolved.conflictResponseCopy, /When conflict erupts|following reactions|preferred conflict processing|What triggers you|control or overpower/);
  assert.equal(resolved.conflictResponseCopy.split(" • ").length, 3);
});

test("conflict source resolver preserves complete wrapped triggered sentences and excludes development goals", () => {
  const { resolveConflictPatternsFromSource } = loadInstructionRuleExtractors();
  const resolved = resolveConflictPatternsFromSource(conflictSourceProfile());

  assert.ok(resolved.conflictTriggeredBullets.includes(vulnerablePatternFromPdf));
  assert.equal(resolved.conflictTriggeredBullets.length, 4);
  assert.equal(resolved.conflictTriggeredCopy, resolved.conflictTriggeredBullets.join(" • "));
  assert.doesNotMatch(resolved.conflictTriggeredCopy, /\n|\.{3}|…|Development goals|build trust|Express your anger directly/);
});

test("conflict source resolver supports report page drift without changing the extracted patterns", () => {
  const { resolveConflictPatternsFromSource } = loadInstructionRuleExtractors();
  const expected = JSON.stringify(resolveConflictPatternsFromSource(conflictSourceProfile()));

  for (const offset of [-1, 1, 2]) {
    assert.equal(JSON.stringify(resolveConflictPatternsFromSource(conflictSourceProfile(offset))), expected);
  }
});

test("conflict source resolver returns only fields backed by an available source section", () => {
  const { resolveConflictPatternsFromSource } = loadInstructionRuleExtractors();
  for (const profile of [null, {}, { reportContent: { pages: [] } }, {
    reportContent: { pages: [{ pageNumber: 30, extractedText: "Development goals: Notice anger and make room for vulnerability." }] },
  }]) {
    assert.equal(JSON.stringify(resolveConflictPatternsFromSource(profile)), "{}");
  }

  const responseOnly = conflictSourceProfile();
  responseOnly.reportContent.pages.pop();
  const resolved = resolveConflictPatternsFromSource(responseOnly);
  assert.ok(resolved.conflictResponseCopy.includes(conflictResponseFromPdf));
  assert.equal(Object.hasOwn(resolved, "conflictTriggeredCopy"), false);
  assert.equal(Object.hasOwn(resolved, "conflictTriggeredBullets"), false);
});
