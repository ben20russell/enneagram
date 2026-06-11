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

function loadFeedbackGuideFromStructuredContentFunction() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "escapeRegex"),
    extractFunctionSource(scriptSource, "buildFlexibleWordPattern"),
    extractFunctionSource(scriptSource, "buildFlexibleLabelPattern"),
    extractFunctionSource(scriptSource, "extractBulletItemsFromText"),
    extractFunctionSource(scriptSource, "isMissingExtractedText"),
    extractFunctionSource(scriptSource, "extractIndexedGuidanceRows"),
    extractFunctionSource(scriptSource, "getReportContentSections"),
    extractFunctionSource(scriptSource, "getReportContentPages"),
    extractConstObjectSource(scriptSource, "ASSIGNED_PDF_INSTRUCTION_RULES"),
    extractConstObjectSource(scriptSource, "PDF_PAGE_ANCHORS"),
    extractFunctionSource(scriptSource, "getReportPageTextByNumber"),
    "const INSTRUCTION_EXTRACTION_ENGINE_CACHE = new WeakMap();",
    extractFunctionSource(scriptSource, "createInstructionExtractionEngine"),
    extractFunctionSource(scriptSource, "getInstructionExtractionEngine"),
    extractFunctionSource(scriptSource, "normalizeInstructionAnchor"),
    extractFunctionSource(scriptSource, "resolveInstructionPageCandidates"),
    extractFunctionSource(scriptSource, "findInstructionAnchorMatch"),
    extractFunctionSource(scriptSource, "extractInstructionTextFromReportContent"),
    extractFunctionSource(scriptSource, "getPageAnchoredText"),
    extractFunctionSource(scriptSource, "getSectionByTitle"),
    extractFunctionSource(scriptSource, "getSectionCompositeText"),
    extractFunctionSource(scriptSource, "extractFeedbackGuideFromReportContent"),
    "globalThis.__exports = { extractFeedbackGuideFromReportContent };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("feedback guide matrix uses page 28-29 anchors and avoids communication footer noise", () => {
  const { extractFeedbackGuideFromReportContent } = loadFeedbackGuideFromStructuredContentFunction();
  const parsedProfile = {
    reportContent: {
      sections: [
        {
          sectionTitle: "Communication",
          pageStart: 24,
          pageEnd: 24,
          fullText:
            "Type 2 Legacy communication placeholder. FEB 2022 [ENGLISH] STRICTLY CONFIDENTIAL INDIVIDUAL PROFESSIONAL Enneagram Report Copyright 210-202",
        },
      ],
      pages: [
        {
          pageNumber: 24,
          heading: "Communication",
          extractedText:
            "Type 2 Legacy row from communication page with footer noise only.",
        },
        {
          pageNumber: 28,
          heading: "Feedback Guide",
          extractedText: `
            Feedback Guide
            1 Begin with appreciation and standards.
            2 Lead with warmth, connection, and practical support.
            3 Keep feedback concise, measurable, and goal-focused.
            4 Validate emotional impact before discussing next steps.
            5 Explain rationale clearly and allow time to process.
          `,
        },
        {
          pageNumber: 29,
          heading: "Feedback Guide",
          extractedText: `
            6 Clarify expectations and likely risks with certainty.
            7 Keep the tone positive while being direct on impact.
            8 Be direct, respectful, and concrete about behavior.
            9 Invite their perspective first and align on next actions.
          `,
        },
      ],
    },
  };

  const rows = extractFeedbackGuideFromReportContent(parsedProfile);
  assert.equal(rows.length, 9);
  assert.match(String(rows[1]?.guidance || ""), /warmth,\s*connection,\s*and practical support/i);
  assert.doesNotMatch(String(rows[1]?.guidance || ""), /strictly confidential|feb\s*2022|copyright/i);
  assert.match(String(rows[8]?.guidance || ""), /invite their perspective first/i);
});
