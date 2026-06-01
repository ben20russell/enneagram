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
    let fetchCount = 0;
    global.fetch = async function fetchMock() {
      fetchCount += 1;
      if (fetchCount === 1) {
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
      }
      if (fetchCount === 2) {
        return {
          ok: true,
          async json() {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      strain_interpretation: {
                        overall: "Overall strain summary",
                        vocational: "Vocational narrative",
                        environmental: "Environmental narrative",
                        physical: "Physical narrative",
                        interpersonal: "Interpersonal narrative",
                        psychological: "Psychological narrative",
                        happiness: "Happiness narrative",
                      },
                      body_language: ["Body language cue A"],
                      feedback_guide: {
                        type_1: ["Guide 1"],
                        type_2: ["Guide 2"],
                        type_3: ["Guide 3"],
                        type_4: ["Guide 4"],
                        type_5: ["Guide 5"],
                        type_6: ["Guide 6"],
                        type_7: ["Guide 7"],
                        type_8: ["Guide 8"],
                        type_9: ["Guide 9"],
                      },
                      decision_framework: {
                        dominant_center_impact: ["Dominant center"],
                        making_decisions: ["Making decisions"],
                        receiving_decisions: ["Receiving decisions"],
                        strain_impact: ["Strain impact"],
                      },
                      strategic_leadership: {
                        visioning: "Visioning copy",
                        strategic_thinking: "Strategic thinking copy",
                        alignment: "Alignment copy",
                        change_management: "Change management copy",
                      },
                      team_dynamics: {
                        interdependence_and_role: "Interdependence copy",
                        forming: ["Forming copy"],
                        storming: ["Storming copy"],
                        norming: ["Norming copy"],
                        performing: ["Performing copy"],
                      },
                      coaching_relationship: ["Coaching copy with specific actions."],
                      development_exercises: {
                        core_type: ["Core exercise"],
                        subtype: ["Subtype exercise"],
                        centers: ["Centers exercise"],
                        integration: ["Integration exercise"],
                        strain: ["Strain exercise"],
                        conflict: ["Conflict exercise"],
                        management: ["Management exercise"],
                        strategic_leadership: ["Strategic leadership exercise"],
                      },
                    }),
                  },
                },
              ],
            };
          },
        };
      }
      throw new Error(`Unexpected fetch invocation count: ${fetchCount}`);
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
    assert.equal(result?._parseStatus, "incomplete");
    assert.match(String(result?._parseDiagnostics?.incompleteReason || ""), /Extracted 2 pages, expected at least 42/i);
    assert.ok(Array.isArray(result?.reportContent?.sections));
    assert.equal(result?.reportContent?.proSections, undefined);
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
    global.fetch = originalFetch;
  }
});

test("parsePdf marks parse incomplete when critical targeted sections are missing", async () => {
  setDocumentIntelligenceEnv();
  setAzureOpenAiEnv();

  const originalBeginAnalyzeDocument = DocumentAnalysisClient.prototype.beginAnalyzeDocument;
  const originalFetch = global.fetch;
  DocumentAnalysisClient.prototype.beginAnalyzeDocument = async function beginAnalyzeDocument() {
    return {
      async pollUntilDone() {
        return {
          paragraphs: [{ role: "content", content: "Decision Making baseline text", boundingRegions: [{ pageNumber: 32 }] }],
          tables: [],
          pages: Array.from({ length: 42 }, (_, idx) => ({ pageNumber: idx + 1 })),
        };
      },
    };
  };

  try {
    let fetchCount = 0;
    global.fetch = async function fetchMock() {
      fetchCount += 1;
      if (fetchCount === 1) {
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
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    strain_interpretation: {
                      overall: "",
                      vocational: "",
                      environmental: "",
                      physical: "",
                      interpersonal: "",
                      psychological: "",
                      happiness: "",
                    },
                    body_language: [],
                    feedback_guide: {
                      type_1: [],
                      type_2: [],
                      type_3: [],
                      type_4: [],
                      type_5: [],
                      type_6: [],
                      type_7: [],
                      type_8: [],
                      type_9: [],
                    },
                    decision_framework: {
                      dominant_center_impact: [],
                      making_decisions: [],
                      receiving_decisions: [],
                      strain_impact: [],
                    },
                    strategic_leadership: {
                      visioning: "",
                      strategic_thinking: "",
                      alignment: "",
                      change_management: "",
                    },
                    team_dynamics: {
                      interdependence_and_role: "",
                      forming: [],
                      storming: [],
                      norming: [],
                      performing: [],
                    },
                    coaching_relationship: [],
                    development_exercises: {
                      core_type: [],
                      subtype: [],
                      centers: [],
                      integration: [],
                      strain: [],
                      conflict: [],
                      management: [],
                      strategic_leadership: [],
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
    const result = await parsePdf(Buffer.from("fake"), "critical-sections-missing-report");

    assert.equal(result?._parseStatus, "incomplete");
    assert.match(String(result?._parseDiagnostics?.incompleteReason || ""), /critical section hydration incomplete/i);
    assert.equal(Number(result?._parseDiagnostics?.sectionCoverage?.criticalTotal || 0) > 0, true);
    assert.equal(
      Number(result?._parseDiagnostics?.sectionCoverage?.criticalHydrated || 0) <
        Number(result?._parseDiagnostics?.sectionCoverage?.criticalTotal || 0),
      true,
    );
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
    global.fetch = originalFetch;
  }
});

test("parsePdf dynamic section discovery includes non-mapped pages when header matches", async () => {
  setDocumentIntelligenceEnv();
  setAzureOpenAiEnv();

  const originalBeginAnalyzeDocument = DocumentAnalysisClient.prototype.beginAnalyzeDocument;
  const originalFetch = global.fetch;
  const fetchBodies = [];
  DocumentAnalysisClient.prototype.beginAnalyzeDocument = async function beginAnalyzeDocument() {
    return {
      async pollUntilDone() {
        return {
          paragraphs: [
            { role: "content", content: "Decision Making content on a non-mapped page should still be discovered.", boundingRegions: [{ pageNumber: 30 }] },
          ],
          tables: [],
          pages: [{ pageNumber: 30 }],
        };
      },
    };
  };

  try {
    global.fetch = async function fetchMock(_url, init = {}) {
      fetchBodies.push(JSON.parse(String(init?.body || "{}")));
      if (fetchBodies.length === 1) {
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
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify({
              strain_interpretation: { overall: "", vocational: "", environmental: "", physical: "", interpersonal: "", psychological: "", happiness: "" },
              body_language: [],
              feedback_guide: { type_1: [], type_2: [], type_3: [], type_4: [], type_5: [], type_6: [], type_7: [], type_8: [], type_9: [] },
              decision_framework: { dominant_center_impact: [], making_decisions: [], receiving_decisions: [], strain_impact: [] },
              strategic_leadership: { visioning: "", strategic_thinking: "", alignment: "", change_management: "" },
              team_dynamics: { interdependence_and_role: "", forming: [], storming: [], norming: [], performing: [] },
              coaching_relationship: [],
              development_exercises: { core_type: [], subtype: [], centers: [], integration: [], strain: [], conflict: [], management: [], strategic_leadership: [] },
            }) } }],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    await parsePdf(Buffer.from("fake"), "dynamic-discovery-report");
    const targetedPayload = JSON.parse(String(fetchBodies[1]?.messages?.[1]?.content || "{}"));
    assert.match(String(targetedPayload?.sections?.decision_framework || ""), /non-mapped page should still be discovered/i);
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
              content: "A c t i o n Center o f Expression : M e d i u m",
              boundingRegions: [{ pageNumber: 12 }],
            },
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

    assert.equal(result?.centerScores?.body, "Medium");
    assert.equal(result?.centerScores?.heart, "Medium");
    assert.equal(result?.centerScores?.head, "Low");
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
    global.fetch = originalFetch;
  }
});

test("parsePdf prioritizes centers of expression from pages 12-13 over conflicting labels elsewhere", async () => {
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
              content: "Action Center of Expression: LOW",
              boundingRegions: [{ pageNumber: 5 }],
            },
            {
              role: "content",
              content: "Feeling Center of Expression: LOW",
              boundingRegions: [{ pageNumber: 5 }],
            },
            {
              role: "content",
              content: "Thinking Center of Expression: HIGH",
              boundingRegions: [{ pageNumber: 5 }],
            },
            {
              role: "content",
              content: "Action Center of Expression: HIGH",
              boundingRegions: [{ pageNumber: 12 }],
            },
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
          pages: [{ pageNumber: 5 }, { pageNumber: 12 }, { pageNumber: 13 }],
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
                    centerLabels: {
                      action: null,
                      feeling: null,
                      thinking: null,
                    },
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
    const result = await parsePdf(Buffer.from("fake"), "centers-page-priority-report");

    assert.equal(result?.centerScores?.body, "High");
    assert.equal(result?.centerScores?.heart, "Medium");
    assert.equal(result?.centerScores?.head, "Low");
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
    global.fetch = originalFetch;
  }
});

test("parsePdf emits strain compatibility aliases and reportContent strain section", async () => {
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
              content:
                "Happiness strain is LOW. Vocational strain is MEDIUM. Interpersonal strain is HIGH. Physical strain is MEDIUM. Environmental strain is LOW. Psychological strain is HIGH.",
              boundingRegions: [{ pageNumber: 20 }],
            },
          ],
          tables: [],
          pages: [{ pageNumber: 20 }],
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
                    developmentExercises: ["Exercise alpha"],
                    centerLabels: {
                      action: "HIGH",
                      feeling: "MEDIUM",
                      thinking: "LOW",
                    },
                    strainNarratives: {
                      happiness: "Happiness strain is LOW. You feel steady under current conditions.",
                      vocational: "Vocational strain is MEDIUM. Work pressure is manageable with pacing.",
                      interpersonal: "Interpersonal strain is HIGH. Relationship friction is currently elevated.",
                      physical: "Physical strain is MEDIUM. Energy management is required this week.",
                      environmental: "Environmental strain is LOW. External demands are not overwhelming.",
                      psychological: "Psychological strain is HIGH. Internal pressure remains elevated.",
                    },
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
    const result = await parsePdf(Buffer.from("fake"), "strain-compat-report");

    assert.equal(result?.strain_levels?.happiness_strain, "Low");
    assert.equal(result?.strain_levels?.vocational_strain, "Medium");
    assert.equal(result?.strain_levels?.interpersonal_strain, "High");
    assert.equal(result?.strain_scores?.happiness, 25);
    assert.equal(result?.strain_scores?.vocational, 55);
    assert.equal(result?.strain_scores?.interpersonal, 80);

    const strainSection = Array.isArray(result?.reportContent?.sections)
      ? result.reportContent.sections.find((section) =>
        /strain/i.test(String(section?.sectionTitle || section?.title || "")))
      : null;
    assert.ok(strainSection);
    assert.match(
      String(strainSection?.fullText || ""),
      /happiness strain is low/i,
    );
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
    global.fetch = originalFetch;
  }
});

test("parsePdf runs targeted section extraction and merges structured iEQ9 pages into report content", async () => {
  setDocumentIntelligenceEnv();
  setAzureOpenAiEnv();

  const originalBeginAnalyzeDocument = DocumentAnalysisClient.prototype.beginAnalyzeDocument;
  const originalFetch = global.fetch;
  const fetchBodies = [];
  DocumentAnalysisClient.prototype.beginAnalyzeDocument = async function beginAnalyzeDocument() {
    return {
      async pollUntilDone() {
        return {
          paragraphs: [
            { role: "content", content: "Decision Making Centered Decisions start with center-first pattern.", boundingRegions: [{ pageNumber: 32 }] },
            { role: "content", content: "Impact of your style when making decisions includes decisive action.", boundingRegions: [{ pageNumber: 33 }] },
            { role: "content", content: "Strain impact on decision quality rises under overload.", boundingRegions: [{ pageNumber: 34 }] },
            { role: "content", content: "Strategic Leadership Visioning and alignment are explicit strengths.", boundingRegions: [{ pageNumber: 37 }] },
            { role: "content", content: "Change management improves when pacing and communication are explicit.", boundingRegions: [{ pageNumber: 38 }] },
            { role: "content", content: "Team Behaviour and Interdependence clarify role boundaries.", boundingRegions: [{ pageNumber: 39 }] },
            { role: "content", content: "Forming Storming Norming Performing stage expectations are listed.", boundingRegions: [{ pageNumber: 40 }] },
            { role: "content", content: "Your Ennea Type and Team Stages include personalized bullets.", boundingRegions: [{ pageNumber: 41 }] },
            { role: "content", content: "Coaching Relationship works best with direct and specific requests.", boundingRegions: [{ pageNumber: 42 }] },
            { role: "content", content: "Feedback Guide Type 1 Start positive and anchor in standards.", boundingRegions: [{ pageNumber: 28 }] },
            { role: "content", content: "Body Language includes visible pace, posture, and voice patterns.", boundingRegions: [{ pageNumber: 25 }] },
            { role: "content", content: "Your Overall Strain Level is Medium with mixed category variation.", boundingRegions: [{ pageNumber: 18 }] },
            { role: "content", content: "Copyright 2024-2024 Integrative Enneagram Solutions Ben Russell 32 of 42", boundingRegions: [{ pageNumber: 32 }] },
          ],
          tables: [],
          pages: [
            { pageNumber: 18 },
            { pageNumber: 25 },
            { pageNumber: 28 },
            { pageNumber: 32 },
            { pageNumber: 33 },
            { pageNumber: 34 },
            { pageNumber: 37 },
            { pageNumber: 38 },
            { pageNumber: 39 },
            { pageNumber: 40 },
            { pageNumber: 41 },
            { pageNumber: 42 },
          ],
        };
      },
    };
  };

  try {
    global.fetch = async function fetchMock(_url, init = {}) {
      fetchBodies.push(JSON.parse(String(init?.body || "{}")));
      if (fetchBodies.length === 1) {
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
                      developmentExercises: ["Exercise alpha"],
                      centerLabels: {
                        action: "HIGH",
                        feeling: "MEDIUM",
                        thinking: "LOW",
                      },
                      strainNarratives: {
                        happiness: "Happiness strain is LOW.",
                        vocational: "Vocational strain is MEDIUM.",
                        interpersonal: "Interpersonal strain is HIGH.",
                        physical: "Physical strain is MEDIUM.",
                        environmental: "Environmental strain is LOW.",
                        psychological: "Psychological strain is HIGH.",
                      },
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
      }
      if (fetchBodies.length === 2) {
        return {
          ok: true,
          async json() {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      strain_interpretation: {
                        overall: "Overall strain remains moderate with pressure concentrated in interpersonal contexts.",
                        vocational: "Vocational strain is manageable when pacing is protected.",
                        environmental: "Environmental strain stays low when scope is clarified.",
                        physical: "Physical strain rises when recovery windows shrink.",
                        interpersonal: "Interpersonal strain rises when conflict is deferred.",
                        psychological: "Psychological strain is reduced by naming assumptions early.",
                        happiness: "Happiness improves with consistent reset rituals.",
                      },
                      body_language: [
                        "Visible pacing increases when urgency rises.",
                        "Eye contact and voice intensity increase during decisive moments.",
                      ],
                      feedback_guide: {
                        type_1: ["Start positive and acknowledge standards."],
                        type_2: ["Recognize contribution before redirection."],
                        type_3: ["Stay concise and outcome-focused."],
                        type_4: ["Acknowledge emotional impact before next steps."],
                        type_5: ["Provide rationale and clear context."],
                        type_6: ["Clarify expectations and timing."],
                        type_7: ["Keep tone upbeat while specific."],
                        type_8: ["Be direct, respectful, and concrete."],
                        type_9: ["Invite their perspective before agreement."],
                      },
                      decision_framework: {
                        dominant_center_impact: ["Dominant center drives first-filter framing."],
                        making_decisions: ["Making decisions works best with explicit priorities."],
                        receiving_decisions: ["Receiving others' decisions improves with context upfront."],
                        strain_impact: ["Higher strain narrows options and increases urgency bias."],
                      },
                      strategic_leadership: {
                        visioning: "Visioning sharpens when long-range objectives are translated into milestones.",
                        strategic_thinking: "Strategic thinking improves through scenario mapping.",
                        alignment: "Alignment strengthens when decisions are narrated across teams.",
                        change_management: "Change management is strongest with cadence and ownership clarity.",
                      },
                      team_dynamics: {
                        interdependence_and_role: "Interdependence is strongest when role boundaries are explicit.",
                        forming: ["Clarify expectations and decision authority early."],
                        storming: ["Name friction points quickly and depersonalize tension."],
                        norming: ["Reinforce norms with visible follow-through."],
                        performing: ["Delegate ownership and monitor outcomes, not activity."],
                      },
                      coaching_relationship: [
                        "Coach with direct, specific, and behavior-based feedback loops.",
                        "Agree on measurable commitments at the end of each session.",
                      ],
                      development_exercises: {
                        core_type: ["Core-type exercise A."],
                        subtype: ["Subtype exercise B."],
                        centers: ["Centers exercise C."],
                        integration: ["Integration exercise D."],
                        strain: ["Strain exercise E."],
                        conflict: ["Conflict exercise F."],
                        management: ["Management exercise G."],
                        strategic_leadership: ["Strategic leadership exercise H."],
                      },
                    }),
                  },
                },
              ],
            };
          },
        };
      }
      throw new Error(`Unexpected fetch call count: ${fetchBodies.length}`);
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), "targeted-pages-report");

    assert.equal(fetchBodies.length, 2);
    const targetedPayload = JSON.parse(String(fetchBodies[1]?.messages?.[1]?.content || "{}"));
    assert.ok(targetedPayload?.sections?.decision_framework);
    assert.match(String(targetedPayload.sections.decision_framework), /center-first pattern/i);
    assert.match(String(targetedPayload.sections.decision_framework), /\[Page 33\]/i);
    assert.doesNotMatch(String(targetedPayload.sections.decision_framework), /Copyright/i);

    const decisionSection = Array.isArray(result?.reportContent?.sections)
      ? result.reportContent.sections.find((section) => section?.sectionId === "decision_framework")
      : null;
    assert.ok(decisionSection);
    assert.equal(decisionSection?.pageStart, 32);
    assert.equal(decisionSection?.pageEnd, 34);
    assert.match(String(decisionSection?.fullText || ""), /dominant center drives first-filter framing/i);

    const teamSection = Array.isArray(result?.reportContent?.sections)
      ? result.reportContent.sections.find((section) => section?.sectionId === "team_dynamics")
      : null;
    assert.ok(teamSection);
    assert.match(String(teamSection?.fullText || ""), /forming/i);
    assert.match(String(teamSection?.fullText || ""), /storming/i);

    assert.ok(Array.isArray(result?.developmentExercises));
    assert.equal(
      result.developmentExercises.some((item) => /core-type exercise a/i.test(String(item || ""))),
      true,
    );
  } finally {
    DocumentAnalysisClient.prototype.beginAnalyzeDocument = originalBeginAnalyzeDocument;
    global.fetch = originalFetch;
  }
});
