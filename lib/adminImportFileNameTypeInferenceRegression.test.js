import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function in source: ${functionName}`);
  }
  const signatureEnd = source.indexOf(")", start);
  const openBrace = source.indexOf("{", signatureEnd);
  if (openBrace === -1) {
    throw new Error(`Could not parse function in source: ${functionName}`);
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

function loadInferTypeFunction(routePath) {
  const source = readFileSync(routePath, "utf8");
  const functionSource = extractFunctionSource(source, "inferTypeFromFileName");
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nglobalThis.__infer = inferTypeFromFileName;`, context);
  return context.globalThis.__infer;
}

function normalizeDetectedType(result) {
  if (result && typeof result === "object") {
    return String(result.detectedType || "").trim() || null;
  }
  return String(result || "").trim() || null;
}

test("admin import file-name type inference ignores iEQ9 product token and only trusts explicit type markers", () => {
  const repoRoot = path.resolve(process.cwd());
  const routePaths = [
    path.join(repoRoot, "app", "api", "admin-import", "route.js"),
    path.join(repoRoot, "app", "api", "admin-import", "reparse", "route.js"),
    path.join(repoRoot, "app", "api", "admin-import", "apply-parsed", "route.js"),
    path.join(repoRoot, "app", "api", "admin-import", "finalize-lite", "route.js"),
  ];

  for (const routePath of routePaths) {
    const inferTypeFromFileName = loadInferTypeFunction(routePath);

    assert.equal(
      normalizeDetectedType(inferTypeFromFileName("iEQ9-Ben-Russell-PRO.pdf")),
      null,
      `Expected ${routePath} to avoid false Type 9 from iEQ9 product token.`,
    );

    assert.equal(
      normalizeDetectedType(inferTypeFromFileName("Ben-Russell-Type-8-Report.pdf")),
      "8",
      `Expected ${routePath} to preserve explicit file-name type markers.`,
    );
  }
});
