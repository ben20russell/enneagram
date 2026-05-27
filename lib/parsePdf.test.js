import test from "node:test";
import assert from "node:assert/strict";
import { DocumentAnalysisClient } from "@azure/ai-form-recognizer";

const parsePdfModuleUrl = new URL("../lib/parsePdf.js", import.meta.url);

function uniqueModuleUrl() {
  return `${parsePdfModuleUrl.href}?v=${Date.now()}-${Math.random()}`;
}

function setDocumentIntelligenceEnv() {
  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://example.cognitiveservices.azure.com";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "test-doc-intelligence-key";
}

test("parsePdf returns needs_review when Document Intelligence env vars are missing", async () => {
  const previousEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const previousKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  try {
    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), "missing-env-report");
    assert.equal(result.reportId, "missing-env-report");
    assert.equal(result.parseStatus, "incomplete");
    assert.equal(result.reviewStatus, "needs_review");
    assert.match(String(result.error || ""), /Missing Azure Document Intelligence environment variables\./);
  } finally {
    if (typeof previousEndpoint === "undefined") {
      delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    } else {
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = previousEndpoint;
    }
    if (typeof previousKey === "undefined") {
      delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    } else {
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = previousKey;
    }
  }
});

test("parsePdf returns complete status when Document Intelligence returns pages", async () => {
  setDocumentIntelligenceEnv();

  const calls = [];
  const originalBeginAnalyzeDocument = DocumentAnalysisClient.prototype.beginAnalyzeDocument;
  DocumentAnalysisClient.prototype.beginAnalyzeDocument = async function beginAnalyzeDocument(
    modelName,
    pdfBuffer,
    options,
  ) {
    calls.push({ modelName, pdfBuffer, options });
    return {
      async pollUntilDone() {
        return {
          paragraphs: [
            { role: "title", content: "Client Report" },
            { role: "pageFooter", content: "Footer text" },
          ],
          tables: [
            {
              cells: [
                { rowIndex: 0, content: "Type" },
                { rowIndex: 0, content: "8" },
              ],
            },
          ],
          pages: [{ pageNumber: 1 }, { pageNumber: 2 }],
        };
      },
    };
  };

  try {
    const { parsePdf } = await import(uniqueModuleUrl());
    const inputBuffer = Buffer.from("fake-pdf-content");
    const result = await parsePdf(inputBuffer, "report-123");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].modelName, "prebuilt-layout");
    assert.equal(calls[0].pdfBuffer, inputBuffer);
    assert.equal(calls[0]?.options?.contentType, "application/pdf");
    assert.equal(result.reportId, "report-123");
    assert.equal(result.parseStatus, "complete");
    assert.equal(result.reviewStatus, "ready");
    assert.equal(result.parsePages, 2);
    assert.equal(result.parseMinExpectedPages, 42);
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
  }
});

test("parsePdf returns incomplete status when no pages are extracted", async () => {
  setDocumentIntelligenceEnv();

  const originalBeginAnalyzeDocument = DocumentAnalysisClient.prototype.beginAnalyzeDocument;
  DocumentAnalysisClient.prototype.beginAnalyzeDocument = async function beginAnalyzeDocument() {
    return {
      async pollUntilDone() {
        return {
          paragraphs: [],
          tables: [],
          pages: [],
        };
      },
    };
  };

  try {
    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), "report-empty");

    assert.equal(result.reportId, "report-empty");
    assert.equal(result.parseStatus, "incomplete");
    assert.equal(result.reviewStatus, "ready");
    assert.equal(result.parsePages, 0);
    assert.equal(result.parseMinExpectedPages, 42);
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
  }
});

test("parsePdf surfaces needs_review when Document Intelligence throws", async () => {
  setDocumentIntelligenceEnv();

  const originalBeginAnalyzeDocument = DocumentAnalysisClient.prototype.beginAnalyzeDocument;
  DocumentAnalysisClient.prototype.beginAnalyzeDocument = async function beginAnalyzeDocument() {
    throw new Error("Simulated Document Intelligence failure");
  };

  try {
    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), "report-error");

    assert.equal(result.reportId, "report-error");
    assert.equal(result.parseStatus, "incomplete");
    assert.equal(result.reviewStatus, "needs_review");
    assert.equal(result.error, "Simulated Document Intelligence failure");
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
  }
});
