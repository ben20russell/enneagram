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
  const paramStart = source.indexOf("(", start);
  if (paramStart === -1) {
    throw new Error(`Could not parse function parameters in dashboard script: ${functionName}`);
  }
  let paramDepth = 0;
  let paramEnd = -1;
  for (let idx = paramStart; idx < source.length; idx += 1) {
    const char = source[idx];
    if (char === "(") paramDepth += 1;
    if (char === ")") {
      paramDepth -= 1;
      if (paramDepth === 0) {
        paramEnd = idx;
        break;
      }
    }
  }
  if (paramEnd === -1) {
    throw new Error(`Could not find function parameter end in dashboard script: ${functionName}`);
  }
  const openBrace = source.indexOf("{", paramEnd);
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
    extractFunctionSource(scriptSource, "hasExcessiveSymbolNoise"),
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

function extractConstSource(source, constName) {
  const startToken = `const ${constName} =`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing constant in dashboard script: ${constName}`);
  }
  const end = source.indexOf(";\n", start);
  if (end === -1) {
    throw new Error(`Could not parse constant in dashboard script: ${constName}`);
  }
  return source.slice(start, end + 2);
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

function loadStrainExtractionFunctions() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "hasExcessiveSymbolNoise"),
    extractFunctionSource(scriptSource, "escapeRegex"),
    extractFunctionSource(scriptSource, "buildFlexibleWordPattern"),
    extractFunctionSource(scriptSource, "buildFlexibleLabelPattern"),
    extractFunctionSource(scriptSource, "extractSnippet"),
    extractFunctionSource(scriptSource, "extractSnippetFromLabels"),
    extractFunctionSource(scriptSource, "getReportContentSections"),
    extractFunctionSource(scriptSource, "getReportContentPages"),
    extractFunctionSource(scriptSource, "getSectionByTitle"),
    extractFunctionSource(scriptSource, "getSectionCompositeText"),
    extractFunctionSource(scriptSource, "getReportPageTextByNumber"),
    extractFunctionSource(scriptSource, "normalizeInstructionAnchor"),
    extractFunctionSource(scriptSource, "resolveInstructionPageCandidates"),
    extractFunctionSource(scriptSource, "findInstructionAnchorMatch"),
    extractFunctionSource(scriptSource, "extractInstructionTextFromReportContent"),
    extractFunctionSource(scriptSource, "getPageAnchoredText"),
    extractFunctionSource(scriptSource, "extractBulletItemsFromText"),
    extractFunctionSource(scriptSource, "extractBulletStrainNarrative"),
    extractFunctionSource(scriptSource, "isLowQualityStrainNarrative"),
    extractFunctionSource(scriptSource, "summarizeOverallStrainText"),
    extractFunctionSource(scriptSource, "extractOverallStrainSummaryFromLlmProfile"),
    extractFunctionSource(scriptSource, "extractOverallStrainSummaryFromReportContent"),
    extractFunctionSource(scriptSource, "extractOverallStrainSummaryFromPdfText"),
    extractFunctionSource(scriptSource, "extractStrainQualitativeFromReportContent"),
    extractConstObjectSource(scriptSource, "ASSIGNED_PDF_INSTRUCTION_RULES"),
    extractConstSource(scriptSource, "PDF_PAGE_ANCHORS"),
    "globalThis.__exports = { extractStrainQualitativeFromReportContent, extractOverallStrainSummaryFromLlmProfile, extractOverallStrainSummaryFromReportContent, extractOverallStrainSummaryFromPdfText };",
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

test("strain narrative quality detector keeps concise category-level narratives", () => {
  const { isLowQualityStrainNarrative } = loadStrainNarrativeFunctions();
  assert.equal(
    isLowQualityStrainNarrative(
      "Vocational strain is MEDIUM. Work demands are present and require steady pacing.",
      "Vocational",
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

test("extractStrainQualitativeFromReportContent pulls bullet-based strain writeups", () => {
  const { extractStrainQualitativeFromReportContent } = loadStrainExtractionFunctions();

  const parsedProfile = {
    reportContent: {
      sections: [{ sectionTitle: "Strain Profile", fullText: "" }],
      pages: [
        {
          pageNumber: 21,
          heading: "Page 21",
          extractedText: `
            Physical Strain
            Ben your perceived level of Physical strain is MEDIUM.
            • You feel somewhat positive or neutral about your health at present
            • You are comfortable with your body and weight but there may be some things you do not quite like or want to accept
            • You may want to improve your fitness levels and spend a bit more time exercising than you're able to
            Interpersonal Strain
            Ben your perceived level of Interpersonal strain is MEDIUM.
            • You are somewhat satisfied with the amount of time you get to spend with friends and family
            • Your social life does not meet all your interpersonal needs and expectations consistently
          `,
          keyDataPoints: [],
        },
      ],
    },
  };

  const rows = extractStrainQualitativeFromReportContent(parsedProfile);
  const physical = rows.find((row) => row.category === "Physical");
  const interpersonal = rows.find((row) => row.category === "Interpersonal");

  assert.match(String(physical?.text || ""), /somewhat positive or neutral about your health/i);
  assert.match(String(interpersonal?.text || ""), /somewhat satisfied with the amount of time/i);
});

test("extractOverallStrainSummaryFromReportContent summarizes page-18 overall strain narrative", () => {
  const { extractOverallStrainSummaryFromReportContent } = loadStrainExtractionFunctions();
  const parsedProfile = {
    reportContent: {
      sections: [{ sectionTitle: "Strain Profile", fullText: "" }],
      pages: [
        {
          pageNumber: 18,
          heading: "Page 18",
          extractedText: `
            Overall Strain Level is MEDIUM.
            You are carrying a noticeable load, but you generally remain able to cope with your present circumstances.
            Demands can drain optimism at times, yet you are not consistently overwhelmed.
            Vocational Strain
          `,
          keyDataPoints: [],
        },
      ],
    },
  };

  const summary = extractOverallStrainSummaryFromReportContent(parsedProfile);
  assert.match(String(summary || ""), /noticeable load/i);
  assert.equal(/vocational strain/i.test(String(summary || "")), false);
});

test("extractOverallStrainSummaryFromReportContent starts from 'Your strain profile provides' and keeps full copy", () => {
  const { extractOverallStrainSummaryFromReportContent } = loadStrainExtractionFunctions();
  const parsedProfile = {
    reportContent: {
      sections: [{ sectionTitle: "Strain Profile", fullText: "" }],
      pages: [
        {
          pageNumber: 18,
          heading: "Page 18",
          extractedText: `
            Page18 Strain Profile
            Your strain profile provides your subjective experience of the amount of stress you are experiencing in your present environment.
            It is measured separately from your Enneagram profile and shows where recovery pacing is currently most important.
            Ben your perceived level of Vocational strain is MEDIUM.
          `,
          keyDataPoints: [],
        },
      ],
    },
  };

  const summary = extractOverallStrainSummaryFromReportContent(parsedProfile);
  assert.match(String(summary || ""), /^Your strain profile provides/i);
  assert.match(String(summary || ""), /recovery pacing is currently most important\./i);
  assert.equal(String(summary || "").includes("..."), false);
  assert.equal(/vocational strain/i.test(String(summary || "")), false);
});

test("extractOverallStrainSummaryFromReportContent excludes development exercise spillover copy", () => {
  const { extractOverallStrainSummaryFromReportContent } = loadStrainExtractionFunctions();
  const parsedProfile = {
    reportContent: {
      sections: [{ sectionTitle: "Strain Profile", fullText: "" }],
      pages: [
        {
          pageNumber: 18,
          heading: "Page 18",
          extractedText: `
            Overall Strain Level is MEDIUM.
            This indicator provides you with an aggregate, big picture view of how much strain you are experiencing at present.
            It combines all the different types of strain you are experiencing and gives you an indicator of where your strain level is at present.
            Even though you may not be feeling like this right now, your current circumstances can shift quickly and if your life circumstances drastically change this score will be affected.
            DEVELOPMENT EXERCISE As you are experiencing a medium level of strain in your life, consider the following prompts to reduce pressure.
            Vocational Strain
          `,
          keyDataPoints: [],
        },
      ],
    },
  };

  const summary = String(extractOverallStrainSummaryFromReportContent(parsedProfile) || "");
  assert.match(summary, /aggregate,\s*big picture view/i);
  assert.match(summary, /drastically change this score will be affected\./i);
  assert.equal(/development exercise/i.test(summary), false);
  assert.equal(/consider the following prompts/i.test(summary), false);
});

test("extractOverallStrainSummaryFromReportContent excludes development exercises spillover copy", () => {
  const { extractOverallStrainSummaryFromReportContent } = loadStrainExtractionFunctions();
  const parsedProfile = {
    reportContent: {
      sections: [{ sectionTitle: "Strain Profile", fullText: "" }],
      pages: [
        {
          pageNumber: 18,
          heading: "Page 18",
          extractedText: `
            Overall Strain Level is MEDIUM.
            This indicator provides you with an aggregate, big picture view of how much strain you are experiencing at present.
            It combines all the different types of strain you are experiencing and gives you an indicator of where your strain level is at present.
            Even though you may not be feeling like this right now, your current circumstances can shift quickly and if your life circumstances drastically change this score will be affected.
            DEVELOPMENT EXERCISES As you are experiencing a medium level of strain in your life, consider the following prompts to reduce pressure.
            Vocational Strain
          `,
          keyDataPoints: [],
        },
      ],
    },
  };

  const summary = String(extractOverallStrainSummaryFromReportContent(parsedProfile) || "");
  assert.match(summary, /aggregate,\s*big picture view/i);
  assert.match(summary, /drastically change this score will be affected\./i);
  assert.equal(/development exercises/i.test(summary), false);
  assert.equal(/consider the following prompts/i.test(summary), false);
});

test("extractOverallStrainSummaryFromLlmProfile trims development exercises spillover copy", () => {
  const { extractOverallStrainSummaryFromLlmProfile } = loadStrainExtractionFunctions();
  const parsedProfile = {
    attachedProfile: {
      strain_profile: {
        overall: {
          summary:
            "This indicator provides you with an aggregate, big picture view of how much strain you are experiencing at present. DEVELOPMENT EXERCISES As you are experiencing a medium level of strain in your life, consider the following prompts to reduce pressure.",
        },
      },
    },
  };
  const summary = String(extractOverallStrainSummaryFromLlmProfile(parsedProfile) || "");
  assert.match(summary, /aggregate,\s*big picture view/i);
  assert.equal(/development exercises/i.test(summary), false);
  assert.equal(/consider the following prompts/i.test(summary), false);
});
