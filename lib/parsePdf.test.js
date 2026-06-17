import test from "node:test";
import assert from "node:assert/strict";
import { LlamaParseReader } from "llamaindex";

const parsePdfModuleUrl = new URL("../lib/parsePdf.js", import.meta.url);

function uniqueModuleUrl() {
  return `${parsePdfModuleUrl.href}?v=${Date.now()}-${Math.random()}`;
}

function setAzureOpenAiEnv() {
  process.env.AZURE_OPENAI_ENDPOINT = "https://example-openai.openai.azure.com";
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME = "gpt-5.4-mini";
  process.env.AZURE_OPENAI_API_KEY = "test-azure-openai-key";
}

function setAzureDocIntelEnv() {
  process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://example-docintel.cognitiveservices.azure.com";
  process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "test-docintel-key";
}

function setLlamaCloudEnv() {
  process.env.LLAMA_CLOUD_API_KEY = "test-llama-cloud-key";
}

const HIDDEN_ANALYST_PROMPT = "Act like an enneagram analyst and identify all of the information necessary to populate the Enneagram Dashboard with the highest level of accuracy.";
const PYTHON_VERIFICATION_OVERRIDE = {
  available: true,
  source: "python_extract_report_pdf",
  fileName: "report.pdf",
  pageCount: 42,
  detectedType: "8",
  detectedTypeSource: "resonanceSentence",
  typeName: "Active Controller",
  instinctCode: "sx",
  instinctLabel: "SX — One-on-One",
  integrationLevel: "Low",
};

function mockAttachedJsonPayload() {
  return {
    client: {
      name: "Test Client",
      date: "2026-05-27",
    },
    core_profile: {
      type_number: 8,
      type_name: "Active Controller",
      core_motivation: "To stay strong and in control.",
      core_fear: "Being controlled by others.",
      instinctual_subtype: {
        type: "SX",
        description: "One-on-one intensity and directness.",
      },
      level_of_integration: "LOW",
      meta_message: "Be honest and direct.",
    },
    strain_profile: {
      overall: { level: "MEDIUM", summary: "Overall strain is moderate." },
      vocational: { level: "LOW", summary: "Vocational strain is low." },
      interpersonal: { level: "HIGH", summary: "Interpersonal strain is elevated." },
      environmental: { level: "LOW", summary: "Environmental strain is low." },
      physical: { level: "MEDIUM", summary: "Physical strain is moderate." },
      psychological: { level: "HIGH", summary: "Psychological strain is high." },
      happiness: { level: "MEDIUM", summary: "Happiness strain is moderate." },
    },
    centers_of_expression: {
      feeling: { level: "MEDIUM", mode: "Externalised", impact: "Balanced emotional expression." },
      action: { level: "HIGH", mode: "Externalised", impact: "Strong action bias." },
      thinking: { level: "LOW", mode: "Internalised", impact: "Thinking center is least expressed." },
    },
    lines_of_development: {
      release_point: { type: "5", description: "Move toward quiet reflection." },
      stretch_point: { type: "2", description: "Move toward relational warmth." },
      wing_influence: ["Type 7 Wing", "Type 9 Wing"],
    },
    communication_dynamics: {
      verbal_style: "Direct and concise.",
      language_cues: "Result-oriented language.",
      listening_habits: "Listens for decision points.",
      body_language: "Strong eye contact and energetic posture.",
    },
    feedback: {
      giving: ["Be direct and specific."],
      receiving: ["Prefers concise and actionable feedback."],
    },
    conflict_and_triggers: {
      primary_triggers: ["Perceived loss of control."],
      behavior_when_triggered: ["Becomes forceful and decisive."],
      what_others_should_do: ["Stay direct and avoid ambiguity."],
    },
    decision_making: {
      approach: "Fast and decisive.",
      drawbacks: "Can skip collaborative input.",
      impact_of_strain: "Higher strain narrows options.",
    },
    leadership_and_management: {
      goal_setting: "Sets ambitious directional goals.",
      planning: "Prefers high-level planning with flexible execution.",
      task_completion: "Pushes hard for completion.",
      delegation: "Delegates when trust is established.",
      performance_management: "Uses direct accountability.",
      motivation: "Motivated by impact and control.",
      strategic_leadership: "Strong at directional leadership under pressure.",
    },
    team_behaviour: {
      ideal_role: "Driver and protector.",
      forming: ["Defines direction early."],
      storming: ["Confronts conflict quickly."],
      norming: ["Sets clear expectations."],
      performing: ["Maintains momentum and accountability."],
    },
    coaching_relationship: {
      needs: ["Direct challenge"],
      challenges: ["Patience with slower pacing"],
      opportunities: ["Delegation and trust-building"],
    },
  };
}

test("parsePdf returns incomplete diagnostics when Azure OpenAI env vars are missing", async () => {
  const previousEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const previousDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
  const previousKey = process.env.AZURE_OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_ENDPOINT;
  delete process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
  delete process.env.AZURE_OPENAI_API_KEY;

  try {
    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "missing-openai-env-report",
      rawTextOverride: "Test override text",
      parseMinExpectedPages: 1,
    });

    assert.equal(result?._parseStatus, "incomplete");
    assert.equal(result?._parseDiagnostics?.isComplete, false);
    assert.match(
      String(result?._parseDiagnostics?.incompleteReason || ""),
      /Missing Azure environment variables:.*AZURE_OPENAI_ENDPOINT/i,
    );
  } finally {
    if (typeof previousEndpoint === "undefined") delete process.env.AZURE_OPENAI_ENDPOINT;
    else process.env.AZURE_OPENAI_ENDPOINT = previousEndpoint;
    if (typeof previousDeployment === "undefined") delete process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
    else process.env.AZURE_OPENAI_DEPLOYMENT_NAME = previousDeployment;
    if (typeof previousKey === "undefined") delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previousKey;
  }
});

test("parsePdf uses attached single-pass JSON parsing and maps core fields into legacy payload keys", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;
  const fetchBodies = [];

  try {
    global.fetch = async function fetchMock(_url, init = {}) {
      fetchBodies.push(JSON.parse(String(init?.body || "{}")));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(mockAttachedJsonPayload()),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "attached-single-pass-report",
      rawTextOverride: "Raw PDF text for attached-style parser",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
    });

    assert.equal(fetchBodies.length, 1);
    assert.equal(fetchBodies[0]?.response_format?.type, "json_schema");
    assert.equal(fetchBodies[0]?.response_format?.json_schema?.strict, true);
    assert.match(
      String(fetchBodies[0]?.messages?.[0]?.content || ""),
      /Act like an enneagram analyst and identify all of the information necessary to populate the Enneagram Dashboard with the highest level of accuracy\./i,
    );
    assert.equal(result?._parseDiagnostics?.parserVersion, "attached-single-pass-v2");
    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?.clientName, "Test Client");
    assert.equal(result?.reportDate, "2026-05-27");
    assert.equal(result?.primaryType, 8);
    assert.equal(result?.typeName, "Active Controller");
    assert.equal(result?.coreFear, "Being controlled by others.");
    assert.equal(result?.coreDesire, "To stay strong and in control.");
    assert.equal(result?.instinctualVariant, "sx");
    assert.equal(result?.metaMessage, "Be honest and direct.");
    assert.equal(result?.centerScores?.body, "High");
    assert.equal(result?.centerScores?.heart, "Medium");
    assert.equal(result?.centerScores?.head, "Low");
    assert.equal(result?.strain_levels?.interpersonal_strain, "High");
    assert.equal(result?.strain_scores?.interpersonal, 100);
    assert.ok(Array.isArray(result?.reportContent?.sections));
    assert.equal(result.reportContent.sections.some((section) => section?.sectionId === "leadership_and_management"), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf marks incomplete when extracted page count is below parseMinExpectedPages", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(mockAttachedJsonPayload()),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "attached-page-threshold-report",
      rawTextOverride: "Raw PDF text for threshold test",
      parseMinExpectedPages: 42,
      pageCountOverride: 1,
    });

    assert.equal(result?._parseStatus, "incomplete");
    assert.match(
      String(result?._parseDiagnostics?.incompleteReason || ""),
      /Extracted 1 pages, expected at least 42/i,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf surfaces OpenAI HTTP errors in incomplete diagnostics", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      return {
        ok: false,
        async text() {
          return "Bad request from OpenAI";
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "attached-openai-http-error-report",
      rawTextOverride: "Raw PDF text for HTTP error test",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
    });

    assert.equal(result?._parseStatus, "incomplete");
    assert.match(
      String(result?._parseDiagnostics?.incompleteReason || ""),
      /Bad request from OpenAI/i,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf chunks oversized raw text and merges partial structured outputs", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;
  const requestBodies = [];

  try {
    global.fetch = async function fetchMock(_url, init = {}) {
      const body = JSON.parse(String(init?.body || "{}"));
      requestBodies.push(body);
      const userContent = String(body?.messages?.[1]?.content || "");
      const chunkMatch = userContent.match(/chunk\s+(\d+)\s+of\s+(\d+)/i);
      const chunkIndex = chunkMatch?.[1] ? Number(chunkMatch[1]) : 1;

      const partial = {
        client: { name: chunkIndex === 1 ? "Chunked Client" : "", date: "2026-06-05" },
        core_profile: {
          type_number: 8,
          type_name: chunkIndex === 2 ? "Active Controller" : "",
          core_motivation: chunkIndex === 3 ? "To stay strong and in control." : "",
          core_fear: chunkIndex >= 2 ? "Being controlled by others." : "",
          instinctual_subtype: { type: "SX", description: "One-on-one intensity." },
          level_of_integration: "LOW",
          meta_message: chunkIndex === 1 ? "Be honest and direct." : "",
        },
        strain_profile: {},
        centers_of_expression: {},
        lines_of_development: { wing_influence: [] },
        communication_dynamics: {},
        feedback: { giving: [], receiving: [] },
        conflict_and_triggers: { primary_triggers: [], behavior_when_triggered: [], what_others_should_do: [] },
        decision_making: {},
        leadership_and_management: {},
        team_behaviour: { forming: [], storming: [], norming: [], performing: [] },
        coaching_relationship: { needs: [], challenges: [], opportunities: [] },
      };

      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(partial),
                },
              },
            ],
          };
        },
      };
    };

    const longRawText = Array.from({ length: 20 }, (_, index) => `Page ${index + 1} sample text`).join(" ");
    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "chunked-raw-text-report",
      rawTextOverride: longRawText,
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      rawTextSinglePassMaxChars: 80,
      rawTextChunkMaxChars: 60,
    });

    assert.ok(requestBodies.length > 1);
    assert.equal(
      requestBodies.every((body) => String(body?.messages?.[0]?.content || "").includes(HIDDEN_ANALYST_PROMPT)),
      true,
    );
    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?.clientName, "Chunked Client");
    assert.equal(result?.typeName, "Active Controller");
    assert.equal(result?.coreFear, "Being controlled by others.");
    assert.equal(result?.coreDesire, "To stay strong and in control.");
    assert.equal(result?.instinctualVariant, "sx");
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf strips cid artifacts before sending chunked raw-text prompts to Azure OpenAI", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;
  const requestBodies = [];

  try {
    global.fetch = async function fetchMock(_url, init = {}) {
      requestBodies.push(JSON.parse(String(init?.body || "{}")));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(mockAttachedJsonPayload()),
                },
              },
            ],
          };
        },
      };
    };

    const noisyRawText = [
      "Page 1: Ben your perceived level of Vocational strain is HIGH.",
      "(cid:4)(cid:42)(cid:43)(cid:52)(cid:45)(cid:36)",
      "You stay focused on outcomes and keep delivery moving.",
      "Page 2: You resonate with the Enneagram type 8 which is also known as the Active Controller.",
    ].join(" ");

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "chunked-cid-noise-report",
      rawTextOverride: noisyRawText.repeat(18),
      parseMinExpectedPages: 1,
      pageCountOverride: 2,
      rawTextSinglePassMaxChars: 220,
      rawTextChunkMaxChars: 160,
    });

    assert.ok(requestBodies.length > 1, "Expected oversized noisy input to trigger chunked parsing.");
    assert.equal(
      requestBodies.every((body) => !/\(cid:\d+\)/i.test(String(body?.messages?.[1]?.content || ""))),
      true,
      "Expected chunked prompt payloads to strip cid artifacts before OpenAI requests.",
    );
    assert.equal(result?._parseStatus, "complete");
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf injects in-document RAG context into OpenAI prompt content by default", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;
  const requestBodies = [];

  try {
    global.fetch = async function fetchMock(_url, init = {}) {
      requestBodies.push(JSON.parse(String(init?.body || "{}")));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(mockAttachedJsonPayload()),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "rag-default-enabled-report",
      rawTextOverride: "Type 8 client with interpersonal strain and integration indicators.",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      pythonVerificationOverride: PYTHON_VERIFICATION_OVERRIDE,
    });

    assert.equal(requestBodies.length, 1);
    const userPromptContent = String(requestBodies[0]?.messages?.[1]?.content || "");
    assert.match(userPromptContent, /Retrieved report excerpts from the uploaded document/i);
    assert.equal(result?._parseDiagnostics?.rag?.enabled, true);
    assert.equal(result?._parseDiagnostics?.rag?.available, true);
    assert.equal(result?._parseDiagnostics?.rag?.source, "uploaded_report_text");
    assert.equal(Number(result?._parseDiagnostics?.rag?.retrievedChunkCount) > 0, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf skips in-document RAG context when disabled in parse options", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;
  const requestBodies = [];

  try {
    global.fetch = async function fetchMock(_url, init = {}) {
      requestBodies.push(JSON.parse(String(init?.body || "{}")));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(mockAttachedJsonPayload()),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "rag-disabled-report",
      rawTextOverride: "Type 8 client with interpersonal strain and integration indicators.",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      pythonVerificationOverride: PYTHON_VERIFICATION_OVERRIDE,
      enableCanonicalRag: false,
    });

    assert.equal(requestBodies.length, 1);
    const userPromptContent = String(requestBodies[0]?.messages?.[1]?.content || "");
    assert.doesNotMatch(userPromptContent, /Retrieved report excerpts from the uploaded document/i);
    assert.equal(result?._parseDiagnostics?.rag?.enabled, false);
    assert.equal(result?._parseDiagnostics?.rag?.available, false);
    assert.equal(result?._parseDiagnostics?.rag?.reason, "disabled");
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf injects extraction-learning priors into OpenAI prompt content when provided", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;
  const requestBodies = [];

  try {
    global.fetch = async function fetchMock(_url, init = {}) {
      requestBodies.push(JSON.parse(String(init?.body || "{}")));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(mockAttachedJsonPayload()),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "extraction-learning-priors-report",
      rawTextOverride: "Type 8 client with interpersonal strain and integration indicators.",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      pythonVerificationOverride: PYTHON_VERIFICATION_OVERRIDE,
      extractionLearningContext: {
        modelVersion: "identity-priors-v1",
        status: "active",
        reason: null,
        hintCount: 2,
        promptHintText:
          "Top reviewed priors: Type 8 appears in 62.5% of reviewed reports. Dominant instinct prior: SX in 58.3% of reviewed reports.",
        training: {
          scannedRowCount: 12,
          trainingSampleCount: 8,
        },
      },
    });

    assert.equal(requestBodies.length, 1);
    const userPromptContent = String(requestBodies[0]?.messages?.[1]?.content || "");
    assert.match(userPromptContent, /Extraction-stage priors from reviewed reports/i);
    assert.match(userPromptContent, /Type 8 appears in 62\.5% of reviewed reports/i);
    assert.equal(result?._parseDiagnostics?.extractionLearning?.status, "active");
    assert.equal(result?._parseDiagnostics?.extractionLearning?.modelVersion, "identity-priors-v1");
    assert.equal(result?._parseDiagnostics?.extractionLearning?.hintCount, 2);
    assert.equal(result?._parseDiagnostics?.extractionLearning?.trainingSampleCount, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf includes Python verification diagnostics as a cross-check after LLM parsing", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(mockAttachedJsonPayload()),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "python-verification-cross-check-report",
      rawTextOverride: "Raw text for verification diagnostics test",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      pythonVerificationOverride: PYTHON_VERIFICATION_OVERRIDE,
    });

    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?._parseDiagnostics?.verification?.available, true);
    assert.equal(result?._parseDiagnostics?.verification?.source, "python_extract_report_pdf");
    assert.equal(result?._parseDiagnostics?.verification?.checks?.primaryType?.status, "match");
    assert.equal(result?._parseDiagnostics?.verification?.checks?.instinctualVariant?.status, "match");
    assert.equal(result?._parseDiagnostics?.verification?.checks?.integrationLevel?.status, "match");
    assert.equal(result?._parseDiagnostics?.verification?.resolvedFields?.primaryType, 8);
    assert.equal(result?._parseDiagnostics?.verification?.resolvedFields?.instinctualVariant, "sx");
    assert.equal(result?._parseDiagnostics?.verification?.resolvedFields?.integrationLevel, "Low");
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf resolves hydration identity fields to Python values when critical identity mismatches are detected", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      const payload = mockAttachedJsonPayload();
      payload.core_profile.type_number = 3;
      payload.core_profile.instinctual_subtype = {
        type: "SO",
        description: "Social emphasis.",
      };
      payload.core_profile.level_of_integration = "HIGH";
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(payload),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "python-identity-authority-mismatch-report",
      rawTextOverride: "Raw text for Python identity authority test",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      pythonVerificationOverride: PYTHON_VERIFICATION_OVERRIDE,
    });

    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?._parseDiagnostics?.verification?.checks?.primaryType?.status, "mismatch");
    assert.equal(result?._parseDiagnostics?.verification?.checks?.instinctualVariant?.status, "mismatch");
    assert.equal(result?._parseDiagnostics?.verification?.checks?.integrationLevel?.status, "mismatch");
    assert.equal(result?._parseDiagnostics?.verification?.resolvedFields?.primaryType, 8);
    assert.equal(result?._parseDiagnostics?.verification?.resolvedFields?.instinctualVariant, "sx");
    assert.equal(result?._parseDiagnostics?.verification?.resolvedFields?.integrationLevel, "Low");
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf keeps LLM as primary parser and uses Python verification only for missing identity fields", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      const payload = mockAttachedJsonPayload();
      payload.core_profile.type_number = null;
      payload.core_profile.type_name = "";
      payload.core_profile.instinctual_subtype = { type: "", description: "" };
      payload.core_profile.level_of_integration = "";
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(payload),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "python-fallback-missing-identity-fields-report",
      rawTextOverride: "Raw text for python fallback identity test",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      pythonVerificationOverride: {
        ...PYTHON_VERIFICATION_OVERRIDE,
        detectedType: "4",
        typeName: "Original Person",
        instinctCode: "so",
        instinctLabel: "SO — Social",
        integrationLevel: "Moderate",
      },
    });

    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?.primaryType, 4);
    assert.equal(result?.typeName, "Original Person");
    assert.equal(result?.instinctualVariant, "so");
    assert.equal(result?.integrationLevel, "Moderate");
    assert.equal(result?.typeScores?.type4, 100);
    assert.equal(result?._parseDiagnostics?.verification?.fallbackApplied?.primaryType, true);
    assert.equal(result?._parseDiagnostics?.verification?.fallbackApplied?.instinctualVariant, true);
    assert.equal(result?._parseDiagnostics?.verification?.fallbackApplied?.integrationLevel, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf backfills report metadata fields from Python verification when LLM metadata is missing", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      const payload = mockAttachedJsonPayload();
      payload.client.name = "";
      payload.client.date = "";
      payload.core_profile.type_number = null;
      payload.core_profile.type_name = "";
      payload.core_profile.instinctual_subtype = { type: "", description: "" };
      payload.core_profile.level_of_integration = "";
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(payload),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "python-metadata-backfill-report",
      rawTextOverride: "Raw text for python metadata fallback test",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      pythonVerificationOverride: {
        ...PYTHON_VERIFICATION_OVERRIDE,
        clientName: "Ben Russell",
        reportDate: "2026-06-01",
        trifix: "8-3-7",
        levelOfDevelopment: "High",
        wing: "8w7",
        centreOfIntelligence: "Body",
      },
    });

    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?.primaryType, 8);
    assert.equal(result?.typeName, "Active Controller");
    assert.equal(result?.clientName, "Ben Russell");
    assert.equal(result?.reportDate, "2026-06-01");
    assert.equal(result?.trifix, "8-3-7");
    assert.equal(result?.levelOfDevelopment, "High");
    assert.equal(result?.wing, "8w7");
    assert.equal(result?.centreOfIntelligence, "Body");
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf replaces placeholder type names with Python verification identity values", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      const payload = mockAttachedJsonPayload();
      payload.core_profile.type_number = null;
      payload.core_profile.type_name = "Copyright";
      payload.core_profile.instinctual_subtype = { type: "", description: "" };
      payload.core_profile.level_of_integration = "";
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(payload),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "python-placeholder-type-name-replacement-report",
      rawTextOverride: "Raw text for python placeholder type-name fallback test",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      pythonVerificationOverride: {
        ...PYTHON_VERIFICATION_OVERRIDE,
        detectedType: "8",
        typeName: "Active Controller",
        instinctCode: "sx",
        integrationLevel: "Low",
      },
    });

    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?.primaryType, 8);
    assert.equal(result?.typeName, "Active Controller");
    assert.equal(result?.instinctualVariant, "sx");
    assert.equal(result?.integrationLevel, "Low");
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf does not infer levelOfDevelopment from integrationLevel when development level is not detected", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      const payload = mockAttachedJsonPayload();
      payload.core_profile.level_of_integration = "LOW";
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(payload),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "no-lod-from-integration-fallback-report",
      rawTextOverride: "Raw text for no level-of-development fallback test",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      pythonVerificationOverride: {
        ...PYTHON_VERIFICATION_OVERRIDE,
        integrationLevel: "Low",
        levelOfDevelopment: null,
      },
    });

    assert.equal(result?._parseStatus, "complete");
    assert.equal(String(result?.integrationLevel || "").toLowerCase(), "low");
    assert.equal(result?.levelOfDevelopment, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf infers primary type from canonical type name when type number is missing", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      const payload = mockAttachedJsonPayload();
      payload.core_profile.type_number = null;
      payload.core_profile.type_name = "Active Controller";
      payload.core_profile.instinctual_subtype = { type: "", description: "" };
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(payload),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "infer-type-number-from-type-name-report",
      rawTextOverride: "Raw text for type-name inferred primary type test",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      enablePythonCrossCheck: false,
    });

    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?.typeName, "Active Controller");
    assert.equal(result?.primaryType, 8);
    assert.equal(result?.typeNumber, "8");
    assert.equal(result?.typeScores?.type8, 100);
  } finally {
    global.fetch = originalFetch;
  }
});

test("parsePdf runtime applies deterministic raw-text fallback when Python cross-check is disabled", async () => {
  setAzureOpenAiEnv();
  const originalFetch = global.fetch;

  try {
    global.fetch = async function fetchMock() {
      const payload = mockAttachedJsonPayload();
      payload.core_profile.type_number = null;
      payload.core_profile.type_name = "";
      payload.core_profile.instinctual_subtype = { type: "", description: "" };
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(payload),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "deterministic-raw-text-fallback-runtime-report",
      rawTextOverride: [
        "Client Name: Ben Russell",
        "M A I N  T Y P E : 8",
        "Dominant Instinct: SX",
      ].join("\n"),
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      enablePythonCrossCheck: false,
    });

    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?.primaryType, 8);
    assert.equal(result?.instinctualVariant, "sx");
    assert.equal(result?._parseDiagnostics?.verification?.fallbackApplied?.primaryType, true);
    assert.equal(result?._parseDiagnostics?.verification?.fallbackApplied?.instinctualVariant, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("extractMarkdownWithAzureDocIntel requests prebuilt-layout markdown output", async () => {
  setAzureDocIntelEnv();
  const { extractMarkdownWithAzureDocIntel } = await import(uniqueModuleUrl());
  const captured = {
    postOptions: null,
  };

  const fakeClient = {
    path() {
      return {
        async post(options) {
          captured.postOptions = options;
          return {
            status: "202",
            body: {},
          };
        },
      };
    },
  };
  const fakePollerFactory = () => ({
    async pollUntilDone() {
      return {
        status: "200",
        body: {
          analyzeResult: {
            content: "# iEQ9 Report\n\n## Main Type\n8",
            contentFormat: "markdown",
          },
        },
      };
    },
  });

  const markdown = await extractMarkdownWithAzureDocIntel(Buffer.from("fake-pdf"), {
    client: fakeClient,
    pollerFactory: fakePollerFactory,
    isUnexpectedResponse: () => false,
    timeoutMs: 1_000,
    sourceFileName: "report.pdf",
  });

  assert.equal(markdown, "# iEQ9 Report\n\n## Main Type\n8");
  assert.equal(captured.postOptions?.queryParameters?.outputContentFormat, "markdown");
});

test("parsePdf uses LlamaParse markdown payload directly for PDF-first LLM parsing", async () => {
  setAzureOpenAiEnv();
  setLlamaCloudEnv();
  const originalFetch = global.fetch;
  const originalLoadDataAsContent = LlamaParseReader.prototype.loadDataAsContent;
  const originalLoadData = LlamaParseReader.prototype.loadData;
  const requestBodies = [];

  try {
    LlamaParseReader.prototype.loadDataAsContent = async function loadDataAsContentMock() {
      return "# iEQ9 Report\n\n## Main Type\n8\n\n## Dominant Instinct\nSX";
    };
    LlamaParseReader.prototype.loadData = async function loadDataMock() {
      return "# iEQ9 Report\n\n## Main Type\n8\n\n## Dominant Instinct\nSX";
    };

    global.fetch = async function fetchMock(_url, init = {}) {
      requestBodies.push(JSON.parse(String(init?.body || "{}")));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(mockAttachedJsonPayload()),
                },
              },
            ],
          };
        },
      };
    };

    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "llamaparse-markdown-report",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
      enablePythonCrossCheck: false,
      allowLocalTextFallback: false,
    });

    assert.equal(result?._parseStatus, "complete");
    assert.equal(result?._parseDiagnostics?.extraction?.method, "llamaparse_markdown");
    const userPromptContent = String(requestBodies?.[0]?.messages?.[1]?.content || "");
    assert.match(
      userPromptContent,
      /extract the required JSON strictly from the following markdown report/i,
    );
    assert.match(userPromptContent, /## Main Type/i);
    assert.match(userPromptContent, /Dominant Instinct/i);
  } finally {
    LlamaParseReader.prototype.loadDataAsContent = originalLoadDataAsContent;
    LlamaParseReader.prototype.loadData = originalLoadData;
    global.fetch = originalFetch;
  }
});

test("parsePdf returns failed diagnostics when Llama Cloud env is missing for PDF-first parsing", async () => {
  setAzureOpenAiEnv();
  const previousLlamaCloudApiKey = process.env.LLAMA_CLOUD_API_KEY;
  delete process.env.LLAMA_CLOUD_API_KEY;

  try {
    const { parsePdf } = await import(uniqueModuleUrl());
    const result = await parsePdf(Buffer.from("fake"), {
      reportId: "missing-doc-intel-env-report",
      parseMinExpectedPages: 1,
      pageCountOverride: 1,
    });
    assert.equal(result?._parseStatus, "incomplete");
    assert.equal(result?._parseState, "failed");
    assert.match(
      String(result?._parseReason || ""),
      /Missing Azure environment variables:.*LLAMA_CLOUD_API_KEY/i,
    );
  } finally {
    if (typeof previousLlamaCloudApiKey === "undefined") delete process.env.LLAMA_CLOUD_API_KEY;
    else process.env.LLAMA_CLOUD_API_KEY = previousLlamaCloudApiKey;
  }
});
