import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");

function loadFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (start < 0) return "";
  const rest = source.slice(start);
  const end = rest.slice(1).search(/\n(?:(?:async )?function |(?:const|let) [A-Za-z_$])/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

function profile(prefix = "Report A") {
  return {
    parseCoverage: { parsedPages: 2, detectedTotalPages: 2, minExpectedPages: 2, isCoverageComplete: true },
    reportContent: { pages: [
      { pageNumber: 1, extractedText: `${prefix} first page with report identity.` },
      { pageNumber: 2, extractedText: `${prefix} second page with development exercises.` },
    ] },
  };
}

async function selectIngestionText(parsedProfile, { id = "report-a", liveText = "Live PDF text", parseDiagnostics = null } = {}) {
  let downloads = 0;
  const context = vm.createContext({
    console: { log() {} },
    parsedProfile, parseDiagnostics,
    data: { id, reportFileName: `${id}.pdf`, reportSignedUrl: `https://example.invalid/${id}?token=expired` },
    ingestionToken: 1, currentReportViewMode: "client-report", likelyProReport: true,
    supportsStrainProfileForAssignedReport: () => true,
    extractPdfTextFromSignedUrl: async () => { downloads++; return liveText; },
  });
  for (const name of ["stripPdfFooterNoiseFragments", "normalizeExtractedText", "isMissingExtractedText", "hasExcessiveSymbolNoise", "resolveCompleteStoredReportText"]) {
    vm.runInContext(loadFunction(name), context);
  }
  const ingestStart = source.indexOf("async function ingestAssignedReportIntoDashboard(");
  const textStart = source.indexOf("    const reportContentText =", ingestStart);
  const textEnd = source.indexOf("    let detectedType =", textStart);
  const downloadStart = source.indexOf("    const supportsStrainProfile = supportsStrainProfileForAssignedReport({", textEnd);
  const downloadEnd = source.indexOf("    if (!detectedType || !basicFear", downloadStart);
  assert.ok(textStart > ingestStart && textEnd > textStart && downloadEnd > downloadStart);
  const text = await vm.runInContext(`(async () => {
    ${source.slice(textStart, textEnd)}
    ${source.slice(downloadStart, downloadEnd)}
    return pdfText;
  })()`, context);
  return { text, downloads };
}

test("complete persisted report pages supply ingestion text without a signed PDF download", async () => {
  const parsed = profile();
  const result = await selectIngestionText(parsed);
  assert.equal(result.downloads, 0);
  assert.equal(result.text, parsed.reportContent.pages.map((page) => page.extractedText).join("\n"));
});

test("A-B-A navigation keeps hydration text stable when the signed PDF expires", async () => {
  const a = profile("Report A");
  const b = profile("Report B");
  const first = await selectIngestionText(a, { liveText: "PDF.js version of report A" });
  const second = await selectIngestionText(b, { id: "report-b", liveText: "PDF.js version of report B" });
  const restored = await selectIngestionText(a, { liveText: "" });
  assert.equal(first.downloads + second.downloads + restored.downloads, 0);
  assert.notEqual(first.text, second.text);
  assert.equal(restored.text, first.text);
});

test("updated pages on the same report row are used immediately without a global text cache", async () => {
  const first = await selectIngestionText(profile("Original report A"));
  const updated = await selectIngestionText(profile("Reparsed report A"));
  assert.notEqual(first.text, updated.text);
  assert.match(updated.text, /Reparsed report A/);
});

test("missing, empty, duplicate, gapped, or incomplete stored pages retain live PDF fallback", async () => {
  const cases = [
    null,
    { ...profile(), reportContent: { pages: [] } },
    { ...profile(), reportContent: { pages: [profile().reportContent.pages[0]] } },
    { ...profile(), reportContent: { pages: [profile().reportContent.pages[0], { pageNumber: 2, extractedText: "" }] } },
    { ...profile(), reportContent: { pages: [profile().reportContent.pages[0], { pageNumber: 2, extractedText: "Not detected in assigned PDF." }] } },
    { ...profile(), reportContent: { pages: [profile().reportContent.pages[0], profile().reportContent.pages[0]] } },
    { ...profile(), reportContent: { pages: [profile().reportContent.pages[0], { pageNumber: 3, extractedText: "Skipped second page" }] } },
    { ...profile(), parseCoverage: { ...profile().parseCoverage, isCoverageComplete: false } },
    { ...profile(), parseCoverage: { parsedPages: 2, minExpectedPages: 3, isCoverageComplete: true } },
    { reportContent: profile().reportContent },
  ];
  for (const parsed of cases) {
    const result = await selectIngestionText(parsed);
    assert.equal(result.downloads, 1);
    assert.equal(result.text, "Live PDF text");
  }
});

test("extraction diagnostics can confirm complete persisted pages when legacy coverage is absent", async () => {
  const parsed = { reportContent: profile().reportContent };
  const result = await selectIngestionText(parsed, {
    parseDiagnostics: { isComplete: true, extraction: { pages: 2, detectedTotalPages: 2, minExpectedPages: 2 } },
  });
  assert.equal(result.downloads, 0);
  assert.match(result.text, /Report A first page/);
});

test("the detected total keeps a complete shorter report usable despite a legacy PRO minimum", async () => {
  const parsed = profile();
  parsed.parseCoverage.minExpectedPages = 42;
  const result = await selectIngestionText(parsed, {
    parseDiagnostics: { isComplete: true, extraction: { pages: 2, detectedTotalPages: 2, minExpectedPages: 42 } },
  });
  assert.equal(result.downloads, 0);
  assert.match(result.text, /Report A second page/);
});
