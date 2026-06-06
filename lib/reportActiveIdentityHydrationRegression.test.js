import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function in report-active route: ${functionName}`);
  }
  const signatureEnd = source.indexOf(")", start);
  const openBrace = source.indexOf("{", signatureEnd);
  if (openBrace === -1) {
    throw new Error(`Could not parse function in report-active route: ${functionName}`);
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

function loadGetIngestedDashboardContext() {
  const repoRoot = path.resolve(process.cwd());
  const routePath = path.join(repoRoot, "app", "api", "report-active", "route.js");
  const source = readFileSync(routePath, "utf8");
  const pieces = [
    extractFunctionSource(source, "normalizeTypeNumber"),
    extractFunctionSource(source, "normalizeInstinctualVariant"),
    extractFunctionSource(source, "normalizeIntegrationLevel"),
    extractFunctionSource(source, "normalizeIdentityContextValue"),
    extractFunctionSource(source, "normalizeResultsData"),
    extractFunctionSource(source, "getVerificationResolvedFields"),
    extractFunctionSource(source, "getIngestedDashboardContext"),
    "globalThis.__exports = { getIngestedDashboardContext };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports.getIngestedDashboardContext;
}

test("report-active identity hydration prefers parsed identity over stale dashboard context", () => {
  const getIngestedDashboardContext = loadGetIngestedDashboardContext();

  const hydrated = getIngestedDashboardContext({
    dashboardContext: {
      detectedType: "9",
      instinct: "so",
      integrationLevel: "Low",
    },
    parsedProfile: {
      primaryType: 8,
      instinctualVariant: "sx",
      integrationLevel: "High",
    },
  });

  assert.equal(hydrated?.detectedType, "8");
  assert.equal(hydrated?.instinct, "sx");
  assert.equal(hydrated?.integrationLevel, "High");
});

test("report-active identity hydration ignores placeholder integration text from dashboard context", () => {
  const getIngestedDashboardContext = loadGetIngestedDashboardContext();

  const hydrated = getIngestedDashboardContext({
    dashboardContext: {
      integrationLevel: "Not detected in assigned PDF.",
    },
    parsedProfile: {
      integrationLevel: "Moderate",
    },
  });

  assert.equal(hydrated?.integrationLevel, "Moderate");
});
