import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function source for ${functionName}`);
  }
  const signatureEnd = source.indexOf(")", start);
  const openBrace = source.indexOf("{", signatureEnd);
  if (openBrace === -1) {
    throw new Error(`Unable to parse function body for ${functionName}`);
  }
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unbalanced braces while extracting ${functionName}`);
}

function loadExportTitleBuilder(report) {
  const source = read(reportScriptPath);
  const pieces = [
    "const REPORT = globalThis.__report;",
    extractFunctionSource(source, "sanitizeExportFileName"),
    extractFunctionSource(source, "resolveDashboardExportClientName"),
    extractFunctionSource(source, "buildDashboardExportTitle"),
    "globalThis.__exports = { buildDashboardExportTitle };",
  ];
  const context = {
    globalThis: {
      __report: report,
    },
  };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports.buildDashboardExportTitle;
}

test("dashboard export title uses report client name followed by Enneagram Dashboard", () => {
  const buildDashboardExportTitle = loadExportTitleBuilder({
    clientName: "Ben Russell",
  });

  assert.equal(buildDashboardExportTitle(), "Ben Russell Enneagram Dashboard");
});

test("dashboard export title falls back to generic label when report client name is unavailable", () => {
  const buildDashboardExportTitle = loadExportTitleBuilder({
    clientName: "Not detected",
  });

  assert.equal(buildDashboardExportTitle(), "Enneagram Dashboard");
});

test("export flow saves generated PDF with the export title as the download filename", () => {
  const source = read(reportScriptPath);

  assert.match(
    source,
    /pdf\.save\(\s*`\$\{exportTitle\}\.pdf`\s*\);/,
    "Expected export flow to call jsPDF.save with the export title filename.",
  );
  assert.doesNotMatch(source, /window\.print\(\)/, "Expected export flow to avoid print dialog usage.");
});
