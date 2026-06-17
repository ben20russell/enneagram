import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("export dashboard PDF builds and downloads with jsPDF instead of invoking browser print", () => {
  const script = read(reportScriptPath);
  const exportFnMatch = script.match(/async\s+function\s+exportDashboardPdf\s*\(\)\s*\{([\s\S]*?)\n\}/);

  assert.ok(exportFnMatch?.[1], "Expected exportDashboardPdf function body");

  const body = exportFnMatch[1];
  assert.match(
    body,
    /const\s+jsPdfCtor\s*=\s*window\.jspdf\?\.jsPDF;/,
    "Expected export flow to use jsPDF for direct PDF generation.",
  );
  assert.match(
    body,
    /pdf\.save\(\s*`\$\{exportTitle\}\.pdf`\s*\);/,
    "Expected export flow to trigger an automatic PDF download.",
  );

  assert.doesNotMatch(
    body,
    /window\.print\(\)/,
    "Expected export flow to avoid opening browser print dialogs.",
  );
});

test("dashboard PDF export targets exclude the top header shell page", () => {
  const script = read(reportScriptPath);

  assert.doesNotMatch(
    script,
    /const\s+header\s*=\s*document\.querySelector\("\.header"\)/,
    "Expected PDF export target selection to exclude the top header block.",
  );
});
