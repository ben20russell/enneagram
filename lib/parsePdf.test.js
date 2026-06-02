import test from "node:test";
import assert from "node:assert/strict";

const parsePdfModuleUrl = new URL("../lib/parsePdf.js", import.meta.url);

function uniqueModuleUrl() {
  return `${parsePdfModuleUrl.href}?v=${Date.now()}-${Math.random()}`;
}

function setAzureOpenAiEnv() {
  process.env.AZURE_OPENAI_ENDPOINT = "https://example-openai.openai.azure.com";
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME = "gpt-5.4-mini";
  process.env.AZURE_OPENAI_API_KEY = "test-azure-openai-key";
}

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
      /Missing Azure OpenAI environment variables\./i,
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
    assert.equal(fetchBodies[0]?.response_format?.type, "json_object");
    assert.equal(result?._parseDiagnostics?.parserVersion, "attached-single-pass-v1");
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
    assert.equal(result?.strain_scores?.interpersonal, 80);
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
