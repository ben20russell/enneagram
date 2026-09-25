import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing dashboard function: ${name}`);
  const end = script.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `Missing end of dashboard function: ${name}`);
  return script.slice(start, end + 2);
}

function loadFunctions() {
  const context = vm.createContext({});
  vm.runInContext([
    "function formatOptionalText(value, fallback) { return String(value || '').trim() || fallback; }",
    "function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }",
    ...[
      "consolidateOverallStrainSummary",
      "resolveOverallStrainDisplaySummary",
      "resolveOverallStrainDisplayLevel",
      "scoreBandLabel",
      "formatStrainCardDetailContent",
    ].map(functionSource),
    "globalThis.functions = { consolidateOverallStrainSummary, resolveOverallStrainDisplaySummary, resolveOverallStrainDisplayLevel, formatStrainCardDetailContent };",
  ].join("\n"), context);
  return context.functions;
}

const mediumRating = "Ben your perceived level of Overall strain is MEDIUM.";
const mediumMeaning = "This indicates that you are experiencing some pressure and strain in your life right now.";
const lowRating = "Corinne your perceived level of Overall strain is LOW.";
const lowMeaning = "This indicates that you are not experiencing a huge amount of pressure and strain in your life right now.";

test("Overall Strain keeps only the reported rating and its next complete sentence", () => {
  const { consolidateOverallStrainSummary } = loadFunctions();
  const source = [
    "Your strain profile describes your subjective experience of stress.",
    "This indicator combines the different types of strain.",
    mediumRating,
    mediumMeaning,
    "If significant stressors are present, this may reflect coping strategies or under-reporting.",
    "Development Exercise: Consider changes to your routine.",
  ].join(" ");

  const result = consolidateOverallStrainSummary(source);
  assert.equal(result, `${mediumRating} ${mediumMeaning}`);
  assert.ok(source.includes(result), "The displayed text must be a verbatim source excerpt");
  assert.ok(result.split(/\s+/).length <= 60);
});

test("low-strain consolidation preserves the client name, negation and subjective rating", () => {
  const { consolidateOverallStrainSummary } = loadFunctions();
  const source = `${lowRating} ${lowMeaning} If you feel unchallenged, this may create complacency.`;
  assert.equal(consolidateOverallStrainSummary(source), `${lowRating} ${lowMeaning}`);
});

test("actual PDF word joins are repaired without changing overall strain meaning", () => {
  const { consolidateOverallStrainSummary } = loadFunctions();
  assert.equal(
    consolidateOverallStrainSummary(`${mediumRating} ${mediumMeaning.replace("right now", "rightnow")}`),
    `${mediumRating} ${mediumMeaning}`,
  );
  assert.equal(
    consolidateOverallStrainSummary(`${lowRating} ${lowMeaning.replace("strain in", "strainin")}`),
    `${lowRating} ${lowMeaning}`,
  );
});

test("consolidation preserves qualifications without rewriting them as certainty", () => {
  const { consolidateOverallStrainSummary } = loadFunctions();
  const source = "You report little overall pressure, although some areas remain challenging. Your score may change with your circumstances.";
  assert.equal(consolidateOverallStrainSummary(source), source);
});

test("repeated source sentences are shown once and the summary stays within two sentences", () => {
  const { consolidateOverallStrainSummary } = loadFunctions();
  assert.equal(
    consolidateOverallStrainSummary(`${mediumRating} ${mediumRating} ${mediumMeaning} Additional context follows.`),
    `${mediumRating} ${mediumMeaning}`,
  );
});

test("the word budget drops a whole second sentence without cutting a qualifier or adding an ellipsis", () => {
  const { consolidateOverallStrainSummary } = loadFunctions();
  const longSecondSentence = `Your report describes ${"current circumstances ".repeat(35)}without comparing you with other people.`;
  assert.equal(consolidateOverallStrainSummary(`${mediumRating} ${longSecondSentence}`), mediumRating);
  assert.equal(consolidateOverallStrainSummary(longSecondSentence), longSecondSentence);
});

test("missing text and incomplete trailing fragments do not produce invented copy", () => {
  const { consolidateOverallStrainSummary } = loadFunctions();
  for (const value of [null, undefined, {}, "", "Not detected in assigned PDF.", "An unfinished excerpt"])
    assert.equal(consolidateOverallStrainSummary(value), null);
  assert.equal(consolidateOverallStrainSummary(`${mediumRating} This unfinished sentence`), mediumRating);
});

test("PDF pages take precedence over generated summaries, including on a client switch", () => {
  const { resolveOverallStrainDisplaySummary } = loadFunctions();
  const ben = { reportContent: { pages: [{ pageNumber: 18, extractedText: `${mediumRating} ${mediumMeaning}` }] } };
  const corinne = { reportContent: { pages: [{ pageNumber: 18, extractedText: `${lowRating} ${lowMeaning}` }] } };
  const original = JSON.stringify([ben, corinne]);
  const generated = "You are coping exceptionally well. You will benefit from more responsibility.";

  assert.equal(resolveOverallStrainDisplaySummary(ben, generated), `${mediumRating} ${mediumMeaning}`);
  assert.equal(resolveOverallStrainDisplaySummary(corinne, generated), `${lowRating} ${lowMeaning}`);
  assert.equal(resolveOverallStrainDisplaySummary(ben, generated), `${mediumRating} ${mediumMeaning}`);
  assert.equal(JSON.stringify([ben, corinne]), original);
});

test("raw PDF text is used when parsed pages are absent; a supplied summary remains an extractive fallback", () => {
  const { resolveOverallStrainDisplaySummary } = loadFunctions();
  assert.equal(
    resolveOverallStrainDisplaySummary({}, "A different summary.", `${mediumRating} ${mediumMeaning}`),
    `${mediumRating} ${mediumMeaning}`,
  );
  assert.equal(resolveOverallStrainDisplaySummary({}, "Your report describes current pressure."), "Your report describes current pressure.");
  assert.equal(resolveOverallStrainDisplaySummary({}, null), null);
});

test("the Overall Strain level follows the PDF statement instead of a conflicting computed average", () => {
  const { resolveOverallStrainDisplayLevel } = loadFunctions();
  assert.equal(resolveOverallStrainDisplayLevel(`${mediumRating} ${mediumMeaning}`, 25), "Medium");
  assert.equal(resolveOverallStrainDisplayLevel(`${lowRating} ${lowMeaning}`, 80), "Low");
  assert.equal(resolveOverallStrainDisplayLevel("Overall strain is HIGH.", 0), "High");
  assert.equal(resolveOverallStrainDisplayLevel("Overall strain is MODERATE.", 0), "Medium");
  assert.equal(resolveOverallStrainDisplayLevel(null, 50), "Medium");
  assert.equal(resolveOverallStrainDisplayLevel(null, null), null);
});

test("the Overall Strain card renders one escaped, concise paragraph with a test target", () => {
  const { formatStrainCardDetailContent } = loadFunctions();
  const detail = "You report pressure at work & at home. Your current circumstances are challenging. Additional explanatory context is omitted.";
  assert.equal(
    formatStrainCardDetailContent(detail, { key: "overall" }),
    '<p data-testid="overall-strain-summary-copy" style="font-size:13px;color:var(--text2)">You report pressure at work &amp; at home. Your current circumstances are challenging.</p>',
  );
});
