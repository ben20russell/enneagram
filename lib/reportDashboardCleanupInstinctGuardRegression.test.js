import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function in cleanup route: ${functionName}`);
  }
  const signatureEnd = source.indexOf(")", start);
  const openBrace = source.indexOf("{", signatureEnd);
  if (openBrace === -1) {
    throw new Error(`Could not parse function in cleanup route: ${functionName}`);
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
    throw new Error(`Missing const object in cleanup route: ${constName}`);
  }
  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) {
    throw new Error(`Could not parse const object in cleanup route: ${constName}`);
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

function loadCleanupGuardFns() {
  const routePath = path.join(
    process.cwd(),
    "app",
    "api",
    "report-hydration",
    "dashboard-copy",
    "cleanup",
    "route.js",
  );
  const source = readFileSync(routePath, "utf8");
  const pieces = [
    "const MAX_TEXT_CHARS = 2200;",
    "const FALLBACK_TEXT = \"Not detected in assigned PDF.\";",
    extractConstObjectSource(source, "INSTINCT_FOREIGN_REFERENCE_PATTERNS"),
    extractFunctionSource(source, "normalizeWhitespace"),
    extractFunctionSource(source, "normalizeText"),
    extractFunctionSource(source, "isMissingText"),
    extractFunctionSource(source, "truncateAtFirstHeadingLeak"),
    extractFunctionSource(source, "getInstinctForeignReferencePatterns"),
    extractFunctionSource(source, "hasInstinctForeignReference"),
    extractFunctionSource(source, "findFirstInstinctForeignReferenceIndex"),
    extractFunctionSource(source, "pruneInstinctGoalFieldText"),
    extractFunctionSource(source, "resolveInstinctGoalFieldGuard"),
    "globalThis.__exports = { hasInstinctForeignReference, pruneInstinctGoalFieldText, resolveInstinctGoalFieldGuard };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("instinct guard detects merged foreign-instinct tokens like SXintensity", () => {
  const { hasInstinctForeignReference } = loadCleanupGuardFns();

  assert.equal(
    hasInstinctForeignReference(
      "This can escalate into SXintensity seeking behavior under stress.",
      "selfPres",
    ),
    true,
    "Expected guard to flag merged SX token spillover in Self-Preservation text.",
  );
});

test("instinct guard down-ranks contaminated Self-Preservation copy in favor of clean fallback", () => {
  const { resolveInstinctGoalFieldGuard } = loadCleanupGuardFns();

  const guard = resolveInstinctGoalFieldGuard({
    fieldKey: "selfPres",
    preferredValue:
      "The focus is survival and practical continuity. This can be contrasted with Social - SO status concerns and SXintensity priorities.",
    fallbackValue: "The focus is survival, practical continuity, and resource stewardship.",
  });

  assert.equal(guard.usedFallback, true);
  assert.equal(guard.downRanked, true);
  assert.match(String(guard.value || ""), /survival,\s*practical continuity/i);
  assert.doesNotMatch(String(guard.value || ""), /Social\s*-\s*SO|SX/i);
});

test("instinct guard preserves clean preferred instinct copy", () => {
  const { resolveInstinctGoalFieldGuard } = loadCleanupGuardFns();

  const guard = resolveInstinctGoalFieldGuard({
    fieldKey: "oneOnOne",
    preferredValue: "The focus is intensity, chemistry, and depth in close one-to-one bonds.",
    fallbackValue: "Not detected in assigned PDF.",
  });

  assert.equal(guard.usedFallback, false);
  assert.equal(guard.downRanked, false);
  assert.match(String(guard.value || ""), /intensity,\s*chemistry/i);
});
