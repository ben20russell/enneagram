import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");
const intro = "27 Subtypes This section helps you understand the impact of biological drives on your personality and defines your behaviour more deeply.";
const heading = "A deeper understanding of the SX - 8 You are passionate, intense and charismatic.";

function loadFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (start < 0) return "";
  const rest = source.slice(start);
  const end = rest.slice(1).search(/\n(?:(?:async )?function |(?:const|let) [A-Za-z_$])/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

function resolveIngestionKeyword(overrides = {}) {
  const context = vm.createContext({
    console: { log() {} }, ingestionToken: 1, data: { id: "report-a", reportFileName: "assigned.pdf" },
    detectedType: "8", instinct: "SX — One-on-One", subtypeKeyword: null,
    pdfText: "", storedReportText: "", reportContentText: intro,
    parsedProfile: {}, serverContext: {}, verificationResolvedFields: {},
    REPORT_EXAMPLES: { 8: { keyword: "Example keyword" } },
    ...overrides,
  });
  for (const name of [
    "stripPdfFooterNoiseFragments", "normalizeExtractedText", "normalizeColonSpacing", "sanitizeSnippet",
    "escapeRegex", "cleanPdfExtractedValue", "extractSnippet", "extractSnippetFromLabels",
    "extractSubtypeKeywordFromPdfText", "resolveDominantInstinctCode", "normalizeAssignedIdentityValue",
    "isMissingExtractedText", "normalizeAssignedSubtypeKeyword", "resolveAssignedSubtypeKeyword",
  ]) vm.runInContext(loadFunction(name), context);
  const marker = "    instinct = instinct || extractInstinctFromPdfText(pdfText);";
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf("    connectedLineA =", start);
  assert.ok(start > marker.length && end > start, "The report ingestion subtype resolution must remain testable.");
  vm.runInContext(source.slice(start, end), context);
  return context.subtypeKeyword;
}

test("subtype identity stays stable when a signed PDF expires and stored pages supply the text", () => {
  const initial = resolveIngestionKeyword({ pdfText: heading, reportContentText: `${intro} ${heading}` });
  const restored = resolveIngestionKeyword({ pdfText: "", reportContentText: `${intro} ${heading}` });
  assert.equal(initial, "SX - 8");
  assert.equal(restored, initial, "The contents introduction must not replace the report's subtype on A-B-A navigation.");
});

test("an explicit parsed subtype keyword takes priority over generic PDF headings", () => {
  assert.equal(resolveIngestionKeyword({
    pdfText: heading, parsedProfile: { subtypeKeyword: "Possession" }, subtypeKeyword: "Possession",
  }), "Possession");
});

test("known report instinct and type resolve the label without downloading the PDF", () => {
  assert.equal(resolveIngestionKeyword({ detectedType: "2", instinct: "SP — Self-Preservation" }), "SP - 2");
  assert.equal(resolveIngestionKeyword({ detectedType: "4", instinct: "SO — Social" }), "SO - 4");
});

test("stored exact subtype headings are usable when structured instinct is unavailable", () => {
  assert.equal(resolveIngestionKeyword({ instinct: null, reportContentText: `${intro} ${heading}` }), "SX - 8");
});

test("table-of-contents prose and example keywords cannot become a missing report subtype", () => {
  assert.equal(resolveIngestionKeyword({ instinct: null }), null);
});

test("prose incorrectly stored as a keyword is rejected in favor of the report identity", () => {
  const invalidKeyword = "This section helps you understand the impact of biological drives on your personality";
  assert.equal(resolveIngestionKeyword({
    subtypeKeyword: invalidKeyword, parsedProfile: { subtypeKeyword: invalidKeyword },
  }), "SX - 8");
});

test("the attached structured subtype supplies identity if other instinct fields are absent", () => {
  assert.equal(resolveIngestionKeyword({
    instinct: null,
    parsedProfile: { attachedProfile: { core_profile: { instinctual_subtype: { type: "One-on-One" } } } },
  }), "SX - 8");
});

test("a different type's stored subtype code cannot override the current report", () => {
  assert.equal(resolveIngestionKeyword({
    subtypeKeyword: "SP - 2", parsedProfile: { subtypeKeyword: "SP - 2" },
  }), "SX - 8");
});
