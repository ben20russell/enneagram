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

function extractConstSource(source, constName) {
  const startToken = `const ${constName} =`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing const in dashboard script: ${constName}`);
  }
  const semicolon = source.indexOf(";", start);
  if (semicolon === -1) {
    throw new Error(`Could not parse const in dashboard script: ${constName}`);
  }
  return source.slice(start, semicolon + 1);
}

function loadMetaCleanupFns() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractConstSource(scriptSource, "META_MESSAGE_SHORT_WORDS"),
    extractFunctionSource(scriptSource, "normalizeMetaMessageLetterSpacing"),
    extractFunctionSource(scriptSource, "cleanupMetaQuote"),
    "globalThis.__exports = { normalizeMetaMessageLetterSpacing, cleanupMetaQuote };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("meta-message cleanup repairs split words like 'di ff erence'", () => {
  const { cleanupMetaQuote } = loadMetaCleanupFns();
  const cleaned = cleanupMetaQuote("YOUR META-MESSAGE: I must be true to myself; I must make a di ff erence");

  assert.match(String(cleaned || ""), /make a difference/i);
  assert.doesNotMatch(String(cleaned || ""), /\bdi\s+ff\s+erence\b/i);
});

test("meta-message cleanup repairs fully letter-spaced words", () => {
  const { normalizeMetaMessageLetterSpacing } = loadMetaCleanupFns();
  const cleaned = normalizeMetaMessageLetterSpacing("I must make a d i f f e r e n c e");

  assert.match(String(cleaned || ""), /\bdifference\b/i);
  assert.doesNotMatch(String(cleaned || ""), /\bd\s+i\s+f\s+f\s+e\s+r\s+e\s+n\s+c\s+e\b/i);
});

test("meta-message cleanup does not merge common short-word phrases", () => {
  const { normalizeMetaMessageLetterSpacing } = loadMetaCleanupFns();
  const cleaned = normalizeMetaMessageLetterSpacing("I choose to be direct.");

  assert.match(String(cleaned || ""), /\bto be direct\b/i);
  assert.doesNotMatch(String(cleaned || ""), /\btobedirect\b/i);
});
