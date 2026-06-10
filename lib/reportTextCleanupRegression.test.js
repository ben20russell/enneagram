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

function loadTextCleanupFns() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "ensureSentenceStartsCapitalized"),
    extractFunctionSource(scriptSource, "formatOptionalText"),
    extractFunctionSource(scriptSource, "escapeHtml"),
    extractFunctionSource(scriptSource, "buildDevExercisePathHtml"),
    "globalThis.__exports = { sanitizeSnippet, ensureSentenceStartsCapitalized, buildDevExercisePathHtml };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("sanitizeSnippet removes OCR C' prefix noise but keeps valid contractions", () => {
  const { sanitizeSnippet } = loadTextCleanupFns();

  assert.equal(
    sanitizeSnippet("C' Your tendency to objectify people makes it easy", null),
    "Your tendency to objectify people makes it easy",
  );
  assert.equal(
    sanitizeSnippet("don't over-index on speed", null),
    "don't over-index on speed",
  );
});

test("sanitizeSnippet repairs OCR split words in assigned-report snippets", () => {
  const { sanitizeSnippet } = loadTextCleanupFns();
  const cleaned = sanitizeSnippet(
    "The world is tough and only the strong sur v ive. Pressure can make it di fficult to connect with others.",
    null,
  );

  assert.match(cleaned, /\bsurvive\b/i);
  assert.match(cleaned, /\bdifficult\b/i);
  assert.doesNotMatch(cleaned, /\bsur v ive\b/i);
  assert.doesNotMatch(cleaned, /\bdi fficult\b/i);
});

test("sanitizeSnippet restores word boundaries for garbled dashboard hydration copy", () => {
  const { sanitizeSnippet } = loadTextCleanupFns();
  const cleaned = sanitizeSnippet(
    "Thew or ld is atough andunj ustplace in whichonlythestrongsurvi ve. Good t hingshappen to thosewhotakecontrol.",
    null,
  );

  assert.equal(
    cleaned,
    "The world is a tough and unjust place in which only the strong survive. Good things happen to those who take control.",
  );
});

test("sanitizeSnippet repairs letter-spaced metadata values into readable words", () => {
  const { sanitizeSnippet } = loadTextCleanupFns();

  assert.equal(
    sanitizeSnippet("B e n   R u s s e l l", null),
    "Ben Russell",
  );
  assert.equal(
    sanitizeSnippet("L e v e l   o f   D e v e l o p m e n t", null),
    "Level of Development",
  );
  assert.equal(
    sanitizeSnippet("C e n t r e   o f   I n t e l l i g e n c e", null),
    "Centre of Intelligence",
  );
});

test("sanitizeSnippet repairs long letter-spaced core-pattern copy", () => {
  const { sanitizeSnippet } = loadTextCleanupFns();
  const cleaned = sanitizeSnippet(
    "A c t i n g f r o m y o u r g u t i n s t i n c t t o m a k e t h i n g s h a p p e n i s s e c o n d n a t u r e t o y o u.",
    null,
  );

  assert.equal(
    cleaned,
    "Acting from your gut instinct to make things happen is second nature to you.",
  );
});

test("sanitizeSnippet removes PDF footer/page-number noise from hydrated dashboard text", () => {
  const { sanitizeSnippet } = loadTextCleanupFns();
  const cleaned = sanitizeSnippet(
    "Stay centered under pressure. FEB 2022 [ENGLISH] STRICTLY CONFIDENTIAL INDIVIDUAL PROFESSIONAL Enneagram Report Copyright 2010-2022 Integrative Enneagram Solutions Ben Russell Page 6 of 42",
    "Not detected in assigned PDF.",
  );

  assert.equal(cleaned, "Stay centered under pressure.");
  assert.doesNotMatch(cleaned, /strictly confidential|copyright|page\s*6|6\s*of\s*42|integrative/i);
});

test("sanitizeSnippet falls back when snippet only contains footer/page-number noise", () => {
  const { sanitizeSnippet } = loadTextCleanupFns();
  const cleaned = sanitizeSnippet(
    "FEB 2022 [ENGLISH] STRICTLY CONFIDENTIAL INDIVIDUAL PROFESSIONAL Enneagram Report Copyright 2010-2022 Integrative Enneagram Solutions Ben Russell 6 of 42",
    "Not detected in assigned PDF.",
  );

  assert.equal(cleaned, "Not detected in assigned PDF.");
});

test("development path cards do not render Extracted from assigned PDF source tag", () => {
  const { buildDevExercisePathHtml } = loadTextCleanupFns();
  const html = buildDevExercisePathHtml([
    {
      title: "Exercise 1",
      text: "Challenge yourself to treat each person with compassion.",
      source: "Extracted from assigned PDF",
    },
  ]);

  assert.match(html, /Exercise 1/);
  assert.doesNotMatch(html, /Extracted from assigned PDF/i);
});

test("ensureSentenceStartsCapitalized promotes lowercase bullet starts to uppercase", () => {
  const { ensureSentenceStartsCapitalized } = loadTextCleanupFns();
  assert.equal(
    ensureSentenceStartsCapitalized("your tendency to overcommit can drain your energy."),
    "Your tendency to overcommit can drain your energy.",
  );
  assert.equal(
    ensureSentenceStartsCapitalized(", there is also an awareness that your strengths can become pressure points."),
    "There is also an awareness that your strengths can become pressure points.",
  );
  assert.equal(
    ensureSentenceStartsCapitalized(". this indicates that you are experiencing some pressure and strain in your life right now."),
    "This indicates that you are experiencing some pressure and strain in your life right now.",
  );
  assert.equal(
    ensureSentenceStartsCapitalized("• you feel supported by close relationships.\n• your wellbeing is steadier this week."),
    "• You feel supported by close relationships. • Your wellbeing is steadier this week.",
  );
  assert.equal(
    ensureSentenceStartsCapitalized("psychological strain is low. you can cope with your present circumstances."),
    "Psychological strain is low. You can cope with your present circumstances.",
  );
});

test("dashboard render helpers normalize capitalization for text and html copy", () => {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const script = readFileSync(reportScriptPath, "utf8");

  assert.match(
    script,
    /function\s+setText\s*\([^)]*\)\s*\{[\s\S]*?ensureSentenceStartsCapitalized\(/,
  );
  assert.match(
    script,
    /function\s+normalizeDashboardHtmlCopy\s*\(/,
  );
  assert.match(
    script,
    /function\s+setHtml\s*\([^)]*\)\s*\{[\s\S]*?normalizeDashboardHtmlCopy\(/,
  );
});
