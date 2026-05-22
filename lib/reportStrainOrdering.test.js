import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function extractConstSource(source, constName) {
  const startToken = `const ${constName} =`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing constant in public/report.html: ${constName}`);
  }
  const end = source.indexOf(";\n", start);
  if (end === -1) {
    throw new Error(`Could not parse constant in public/report.html: ${constName}`);
  }
  return source.slice(start, end + 2);
}

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function in public/report.html: ${functionName}`);
  }
  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) {
    throw new Error(`Could not parse function in public/report.html: ${functionName}`);
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

function loadStrainOrderingFunctionsFromReportHtml() {
  const reportHtmlPath = path.join(process.cwd(), "public", "report.html");
  const htmlSource = readFileSync(reportHtmlPath, "utf8");
  const pieces = [
    extractConstSource(htmlSource, "STRAIN_BREAKDOWN_ORDER"),
    extractConstSource(htmlSource, "STRAIN_LEVEL_SORT_RANK"),
    extractFunctionSource(htmlSource, "getStrainLevelSortRank"),
    extractFunctionSource(htmlSource, "scoreBandLabel"),
    extractFunctionSource(htmlSource, "getStrainValueByKey"),
    extractFunctionSource(htmlSource, "buildSortedStrainWriteupRows"),
    "globalThis.__exports = { buildSortedStrainWriteupRows, scoreBandLabel };",
  ];

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("buildSortedStrainWriteupRows keeps Overall Strain first and sorts remaining cards by High/Medium/Low", () => {
  const { buildSortedStrainWriteupRows } = loadStrainOrderingFunctionsFromReportHtml();
  const rows = buildSortedStrainWriteupRows(
    {
      overall: 48,
      happiness: 18,
      vocational: 42,
      interpersonal: 86,
      physical: 55,
      environmental: 12,
      psychological: 39,
    },
    null,
    48,
  );
  const titles = Array.from(rows, (row) => `${row.title}:${row.level}`);
  assert.equal(JSON.stringify(titles), JSON.stringify([
    "Overall Strain:Medium",
    "Interpersonal:High",
    "Physical:Medium",
    "Vocational:Medium",
    "Psychological:Medium",
    "Happiness:Low",
    "Environmental:Low",
  ]));
});
