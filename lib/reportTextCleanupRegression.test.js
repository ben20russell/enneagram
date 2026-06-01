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
