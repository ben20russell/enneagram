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

function setAzureOpenAiEnv() {
  process.env.AZURE_OPENAI_ENDPOINT = "https://example-openai.openai.azure.com";
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME = "gpt-5.4-mini";
  process.env.AZURE_OPENAI_API_KEY = "test-azure-openai-key";
}

test("parsePdf returns needs_review when Document Intelligence env vars are missing", async () => {
  const previousEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const previousKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  try {
    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), "missing-env-report");
    assert.equal(result?._parseDiagnostics?.isComplete, false);
    assert.match(
      String(result?._parseDiagnostics?.incompleteReason || ""),
      /Missing Azure Document Intelligence environment variables\./,
    );
    assert.equal(result?._parseDiagnostics?.extraction?.pages, 0);
    assert.equal(result?._parseDiagnostics?.extraction?.minExpectedPages, 42);
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
  setAzureOpenAiEnv();

  const calls = [];
  const originalBeginAnalyzeDocument = DocumentAnalysisClient.prototype.beginAnalyzeDocument;
  const originalFetch = global.fetch;
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
    global.fetch = async function fetchMock() {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    clientName: "Test Client",
                    reportDate: "2026-05-27",
                    primaryType: 8,
                    wing: 7,
                    instinctualVariant: "sx",
                    levelOfDevelopment: 4,
                    integrationLevel: "moderate",
                    subtypeKeyword: "possession",
                    worldview: "test worldview",
                    focusOfAttention: "test focus",
                    coreFear: "test fear",
                    coreDesire: "test desire",
                    selfTalk: "test self talk",
                    passion: "test passion",
                    reportSummary: "test summary",
                    metaMessage: "test meta",
                    connectedLineA: "5",
                    connectedLineB: "2",
                    centreOfIntelligence: "Body",
                    reportContent: {
                      sections: [],
                      proSections: null,
                      developmentExercisesText: null,
                      documentSummary: "summary",
                    },
                  }),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const inputBuffer = Buffer.from("fake-pdf-content");
    const result = await parsePdf(inputBuffer, "report-123");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].modelName, "prebuilt-layout");
    assert.equal(calls[0].pdfBuffer, inputBuffer);
    assert.equal(calls[0]?.options?.contentType, "application/pdf");
    assert.equal(result.primaryType, 8);
    assert.equal(result?._parseDiagnostics?.extraction?.pages, 2);
    assert.equal(result?._parseDiagnostics?.extraction?.minExpectedPages, 42);
    assert.equal(result?._parseDiagnostics?.rawScores?.type1 != null, true);
    assert.equal(result?._parseDiagnostics?.rawScores?.sexual != null, true);
    assert.equal(result?._parseDiagnostics?.rawScores?.body != null, true);
    assert.ok(Array.isArray(result?.reportContent?.sections));
    assert.equal(result?.reportContent?.proSections, undefined);
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
    global.fetch = originalFetch;
  }
});

test("parsePdf returns incomplete status when no pages are extracted", async () => {
  setDocumentIntelligenceEnv();
  setAzureOpenAiEnv();

  const originalBeginAnalyzeDocument = DocumentAnalysisClient.prototype.beginAnalyzeDocument;
  const originalFetch = global.fetch;
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
    global.fetch = async function fetchMock() {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    clientName: "Test Client",
                    reportDate: "2026-05-27",
                    primaryType: 8,
                    wing: 7,
                    instinctualVariant: "sx",
                    levelOfDevelopment: 4,
                    integrationLevel: "moderate",
                    subtypeKeyword: "possession",
                    worldview: "test worldview",
                    focusOfAttention: "test focus",
                    coreFear: "test fear",
                    coreDesire: "test desire",
                    selfTalk: "test self talk",
                    passion: "test passion",
                    reportSummary: "test summary",
                    metaMessage: "test meta",
                    connectedLineA: "5",
                    connectedLineB: "2",
                    centreOfIntelligence: "Body",
                    reportContent: {
                      sections: [],
                      proSections: null,
                      developmentExercisesText: null,
                      documentSummary: "summary",
                    },
                  }),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), "report-empty");

    assert.equal(result?._parseDiagnostics?.extraction?.pages, 42);
    assert.equal(result?._parseDiagnostics?.extraction?.minExpectedPages, 42);
    assert.equal(result?._parseDiagnostics?.rawScores?.type1 != null, true);
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
    global.fetch = originalFetch;
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

    assert.equal(result?._parseDiagnostics?.isComplete, false);
    assert.equal(result?._parseDiagnostics?.incompleteReason, "Simulated Document Intelligence failure");
    assert.equal(result?._parseDiagnostics?.extraction?.pages, 0);
    assert.equal(result?._parseDiagnostics?.extraction?.minExpectedPages, 42);
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
  }
});

test("parsePdf maps qualitative Centers of Expression levels from extracted text", async () => {
  setDocumentIntelligenceEnv();
  setAzureOpenAiEnv();

  const originalBeginAnalyzeDocument = DocumentAnalysisClient.prototype.beginAnalyzeDocument;
  const originalFetch = global.fetch;
  DocumentAnalysisClient.prototype.beginAnalyzeDocument = async function beginAnalyzeDocument() {
    return {
      async pollUntilDone() {
        return {
          paragraphs: [
            {
              role: "content",
              content: "Feeling Center of Expression: MEDIUM",
              boundingRegions: [{ pageNumber: 13 }],
            },
            {
              role: "content",
              content: "Thinking Center of Expression: LOW",
              boundingRegions: [{ pageNumber: 13 }],
            },
          ],
          tables: [],
          pages: [{ pageNumber: 13 }],
        };
      },
    };
  };

  try {
    global.fetch = async function fetchMock() {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    clientName: "Test Client",
                    reportDate: "2026-05-27",
                    primaryType: 8,
                    typeName: "Active Controller",
                    wing: 9,
                    instinctualVariant: "sx",
                    levelOfDevelopment: 4,
                    integrationLevel: "moderate",
                    subtypeKeyword: "possession",
                    worldview: "test worldview",
                    focusOfAttention: "test focus",
                    coreFear: "test fear",
                    coreDesire: "test desire",
                    selfTalk: "test self talk",
                    passion: "test passion",
                    reportSummary: "test summary",
                    metaMessage: "test meta",
                    connectedLineA: "5",
                    connectedLineB: "2",
                    centreOfIntelligence: "Body",
                    reportContent: {
                      sections: [],
                      proSections: null,
                      developmentExercisesText: null,
                      documentSummary: "summary",
                    },
                  }),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), "qualitative-centers-report");

    assert.equal(result?.centerScores?.heart, "Medium");
    assert.equal(result?.centerScores?.head, "Low");
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
    global.fetch = originalFetch;
  }
});
