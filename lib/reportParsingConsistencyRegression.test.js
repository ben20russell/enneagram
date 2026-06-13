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

function loadParsingFns() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripControlNoiseCharacters"),
    extractFunctionSource(scriptSource, "hasExcessiveSymbolNoise"),
    extractFunctionSource(scriptSource, "isCorruptedExtractedSnippet"),
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    extractFunctionSource(scriptSource, "escapeRegex"),
    extractFunctionSource(scriptSource, "buildFlexibleWordPattern"),
    extractFunctionSource(scriptSource, "buildFlexibleLabelPattern"),
    extractFunctionSource(scriptSource, "buildFlexiblePhrasePattern"),
    extractFunctionSource(scriptSource, "extractSnippet"),
    extractFunctionSource(scriptSource, "extractSnippetFromLabels"),
    extractFunctionSource(scriptSource, "extractBulletItemsFromText"),
    extractFunctionSource(scriptSource, "extractBulletStrainNarrative"),
    extractFunctionSource(scriptSource, "isLowQualityStrainNarrative"),
    extractFunctionSource(scriptSource, "extractStrainQualitativeWriteups"),
    extractFunctionSource(scriptSource, "extractTeamStageSnippet"),
    extractFunctionSource(scriptSource, "extractTeamStageBreakdownFromLegacyFields"),
    extractFunctionSource(scriptSource, "extractPdfPageTextFromItems"),
    "globalThis.__exports = { sanitizeSnippet, extractStrainQualitativeWriteups, extractTeamStageSnippet, extractTeamStageBreakdownFromLegacyFields, extractPdfPageTextFromItems };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("sanitizeSnippet drops high-noise OCR fragments with control characters to fallback copy", () => {
  const { sanitizeSnippet } = loadParsingFns();
  const fallback = "Not detected in assigned PDF.";
  const noisy = "reality. \u0004 * + 4 - $ \" # / \u0001 \u007f } ~ } ¦ \u007f } \u007f \u007f \u0001 ) / \" - \u001c / $ 1 \u0001 \u0006 ) ) \u001c \" - \u001c ( \u0001 \u0014 * ' 0 / $ * ). \u0003 ) \u0001 \u0013 0.. ' ' \u007f } \u0001 *! \u0001 \u0081 \u007f Page 20 Page 20 Ben your perceived level o f";
  const cleaned = sanitizeSnippet(noisy, fallback);

  assert.equal(cleaned, fallback);
});

test("extractStrainQualitativeWriteups rejects corrupted category narratives and keeps clean categories", () => {
  const { extractStrainQualitativeWriteups } = loadParsingFns();
  const source = [
    "Strain Profile",
    "Ben your perceived level of Vocational strain is MEDIUM.",
    "reality. \u0004 * + 4 - $ \" # / \u0001 \u007f } ~ } ¦ \u007f } \u007f \u007f \u0001 ) / \" - \u001c / $ 1 \u0001 \u0006 ) ) \u001c \" - \u001c ( \u0001 \u0014",
    "Ben your perceived level of Interpersonal strain is LOW.",
    "You can recover quickly when conflict is addressed directly.",
  ].join(" ");
  const rows = extractStrainQualitativeWriteups(source);
  const byCategory = new Map(rows.map((row) => [String(row?.category || ""), String(row?.text || "")]));

  assert.equal(
    byCategory.get("Vocational"),
    "Not detected in assigned PDF.",
    "Expected corrupted vocational narrative to be dropped.",
  );
  assert.match(
    byCategory.get("Interpersonal") || "",
    /Interpersonal strain is LOW\./i,
    "Expected clean interpersonal narrative extraction to remain intact.",
  );
});

test("extractTeamStageSnippet avoids stage-chain overview bleed when hydrating Forming guidance", () => {
  const { extractTeamStageSnippet } = loadParsingFns();
  const source = [
    "Team Behaviour",
    "Forming - Storming - Norming - Performing, illustrate the process through which teams g o a s i t becomes more e ff ective over time.",
    "Forming Members are polite and seek clarity about purpose and roles.",
    "Storming Tensions emerge as priorities and styles diverge.",
  ].join(" ");

  const forming = extractTeamStageSnippet(source, "Forming", ["Storming", "Norming", "Performing"]);

  assert.doesNotMatch(
    String(forming || ""),
    /Storming\s*-\s*Norming\s*-\s*Performing/i,
    "Expected Forming extraction to skip introductory stage-chain text.",
  );
  assert.match(
    String(forming || ""),
    /Members are polite and seek clarity/i,
    "Expected Forming extraction to keep stage-specific guidance copy.",
  );
});

test("extractTeamStageSnippet skips introductory Tuckman overview text when a later explicit stage block exists", () => {
  const { extractTeamStageSnippet } = loadParsingFns();
  const source = [
    "Team Behaviour",
    "Forming - Storming - Norming - Performing, illustrate the process through which teams go as it becomes more effective over time.",
    "In reality, some teams get stuck and struggle to move beyond the Forming and Storming phases.",
    "FORMING: This is the first stage of team development. Members establish role clarity and ways of working.",
    "STORMING: This is the second stage of team development. Conflict surfaces and priorities diverge.",
  ].join(" ");

  const forming = extractTeamStageSnippet(source, "Forming", ["Storming", "Norming", "Performing"]);

  assert.match(
    String(forming || ""),
    /first stage of team development/i,
    "Expected Forming extraction to use the explicit FORMING block when available.",
  );
  assert.doesNotMatch(
    String(forming || ""),
    /illustrate the process through which teams go/i,
    "Expected Forming extraction to skip introductory stage-overview phrasing.",
  );
});

test("extractTeamStageBreakdownFromLegacyFields parses serialized team-behaviour fallback payloads", () => {
  const { extractTeamStageBreakdownFromLegacyFields } = loadParsingFns();
  const parsedProfile = {
    spreadsheetFocuses: {
      teamBehaviour: JSON.stringify({
        forming: [
          "During Forming, establish purpose, role clarity, and early ways of working.",
        ],
        storming: [
          "In Storming, name conflict directly and turn tension into productive dialogue.",
        ],
        norming: [
          "During Norming, codify team rituals and shared accountability checkpoints.",
        ],
        performing: [
          "In Performing, keep learning loops active while delegating authority broadly.",
        ],
      }),
    },
  };

  const result = extractTeamStageBreakdownFromLegacyFields(parsedProfile);

  assert.ok(result, "Expected legacy team-behaviour payload to produce a stage breakdown.");
  assert.match(
    String(result?.forming || ""),
    /role clarity/i,
    "Expected Forming copy to be recovered from legacy payload text.",
  );
  assert.match(
    String(result?.storming || ""),
    /productive dialogue/i,
    "Expected Storming copy to be recovered from legacy payload text.",
  );
  assert.match(
    String(result?.norming || ""),
    /shared accountability/i,
    "Expected Norming copy to be recovered from legacy payload text.",
  );
  assert.match(
    String(result?.performing || ""),
    /delegating authority/i,
    "Expected Performing copy to be recovered from legacy payload text.",
  );
});

test("extractPdfPageTextFromItems reconstructs text in positional reading order", () => {
  const { extractPdfPageTextFromItems } = loadParsingFns();
  const items = [
    { str: "Main", transform: [1, 0, 0, 1, 50, 700] },
    { str: "Type", transform: [1, 0, 0, 1, 100, 700] },
    { str: "#", transform: [1, 0, 0, 1, 160, 700] },
    { str: "8", transform: [1, 0, 0, 1, 190, 700] },
    { str: "with", transform: [1, 0, 0, 1, 60, 680] },
    { str: "a", transform: [1, 0, 0, 1, 95, 680] },
    { str: "SX", transform: [1, 0, 0, 1, 110, 680] },
    { str: "instinct.", transform: [1, 0, 0, 1, 155, 680] },
  ];

  const reconstructed = extractPdfPageTextFromItems(items);

  assert.match(reconstructed, /Main Type # 8/);
  assert.match(reconstructed, /with a SX instinct\./);
  assert.match(
    reconstructed,
    /Main Type # 8\s*\n\s*with a SX instinct\./,
    "Expected reconstructed page text to preserve line boundaries across y-jumps.",
  );
  assert.ok(
    reconstructed.indexOf("Main Type # 8") < reconstructed.indexOf("with a SX instinct."),
    "Expected reading-order reconstruction to keep header line before paragraph line.",
  );
});
