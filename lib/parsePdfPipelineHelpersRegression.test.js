import test from "node:test";
import assert from "node:assert/strict";

const parsePdfModuleUrl = new URL("../lib/parsePdf.js", import.meta.url);

function uniqueModuleUrl() {
  return `${parsePdfModuleUrl.href}?v=${Date.now()}-${Math.random()}`;
}

test("mergeStructuredObjects merges chunk object arrays without losing nested values", async () => {
  const { mergeStructuredObjects } = await import(uniqueModuleUrl());

  const merged = mergeStructuredObjects([
    {
      core_profile: {
        type_number: null,
        type_name: "",
        instinctual_subtype: {
          type: "SX",
          description: "",
        },
      },
      notes: ["direct"],
    },
    {
      core_profile: {
        type_number: 8,
        type_name: "Active Controller",
        instinctual_subtype: {
          description: "One-on-one intensity.",
        },
      },
      notes: ["direct", "decisive"],
    },
    {
      core_profile: {
        core_fear: "Being controlled by others.",
      },
      notes: ["protective"],
    },
  ]);

  assert.equal(merged?.core_profile?.type_number, 8);
  assert.equal(merged?.core_profile?.type_name, "Active Controller");
  assert.equal(merged?.core_profile?.instinctual_subtype?.type, "SX");
  assert.equal(merged?.core_profile?.instinctual_subtype?.description, "One-on-one intensity.");
  assert.equal(merged?.core_profile?.core_fear, "Being controlled by others.");
  assert.deepEqual(merged?.notes, ["direct", "decisive", "protective"]);
});

test("extractStructuredJsonFromRawText(text) chunks long text with overlap and merges mocked chunk parses", async () => {
  const { extractStructuredJsonFromRawText } = await import(uniqueModuleUrl());
  const chunkCalls = [];

  const longText = [
    "Client Name: Ben Russell",
    "Report Date: 2026-06-14",
    "M A I N  T Y P E  8",
    "Dominant Instinct: SX",
    "Strain Profile summary indicates moderate load.",
  ]
    .join("\n")
    .repeat(20);

  const merged = await extractStructuredJsonFromRawText(longText, {
    maxSinglePassChars: 300,
    maxChunkChars: 220,
    chunkOverlapChars: 60,
    parseChunkWithLlm: async ({ chunkText, chunkIndex, totalChunks }) => {
      chunkCalls.push({ chunkIndex, totalChunks, textLength: chunkText.length });

      const partial = {
        client: { name: null, date: null },
        core_profile: {
          type_number: null,
          instinctual_subtype: { type: null, description: null },
        },
        strain_profile: {
          overall: { level: null, summary: null },
        },
      };

      if (/Client\s*Name\s*:\s*Ben\s+Russell/i.test(chunkText)) {
        partial.client.name = "Ben Russell";
      }
      if (/Report\s*Date\s*:\s*2026-06-14/i.test(chunkText)) {
        partial.client.date = "2026-06-14";
      }
      if (/M\s*A\s*I\s*N\s*T\s*Y\s*P\s*E\s*8/i.test(chunkText)) {
        partial.core_profile.type_number = 8;
      }
      if (/Dominant\s*Instinct\s*:\s*SX/i.test(chunkText)) {
        partial.core_profile.instinctual_subtype.type = "SX";
      }
      if (/Strain\s*Profile/i.test(chunkText)) {
        partial.strain_profile.overall.summary = "Moderate load";
      }

      return partial;
    },
  });

  assert.ok(chunkCalls.length > 1, "Expected long text to be chunked into multiple LLM calls");
  assert.equal(merged?.client?.name, "Ben Russell");
  assert.equal(merged?.client?.date, "2026-06-14");
  assert.equal(merged?.core_profile?.type_number, 8);
  assert.equal(merged?.core_profile?.instinctual_subtype?.type, "SX");
  assert.equal(merged?.strain_profile?.overall?.summary, "Moderate load");
});

test("buildCanonicalRagContext(text, keywords) prioritizes keyword-rich excerpts", async () => {
  const { buildCanonicalRagContext } = await import(uniqueModuleUrl());

  const rawText = [
    "Intro paragraph about general report context.",
    "Strain Profile: Vocational strain is elevated while interpersonal strain remains moderate.",
    "Additional detail: Instinct focus indicates SX with one-on-one intensity and directness.",
    "Closing paragraph with non-critical summary.",
  ].join("\n\n");

  const context = await buildCanonicalRagContext(rawText, ["Strain Profile", "Instinct"]);

  assert.match(String(context), /Strain Profile/i);
  assert.match(String(context), /Instinct/i);
  assert.match(String(context), /Retrieved report excerpts|Reference/i);
});

test("applyPythonVerificationFallbacksToParsedData(llm_json, raw_text) deterministically patches missing critical fields", async () => {
  const { applyPythonVerificationFallbacksToParsedData } = await import(uniqueModuleUrl());

  const llmParsed = {
    primary_type: null,
    dominant_instinct: null,
    core_profile: {
      type_number: null,
      instinctual_subtype: {
        type: null,
      },
    },
  };

  const rawText = `
    Candidate details
    M A I N  T Y P E : 8
    Dominant Instinct: SX
  `;

  const patched = applyPythonVerificationFallbacksToParsedData(llmParsed, rawText);

  assert.equal(patched?.primary_type, "8");
  assert.equal(patched?.dominant_instinct, "sx");
  assert.equal(patched?.core_profile?.type_number, 8);
  assert.equal(patched?.core_profile?.instinctual_subtype?.type, "SX");
});

test("agenticOcrRepair uses strict OCR-repair prompt and returns repaired text", async () => {
  const { agenticOcrRepair } = await import(uniqueModuleUrl());
  let capturedRequestBody = null;

  const repaired = await agenticOcrRepair("<table><tr><td>Sum m ary</td></tr></table>", {
    openAiUrl: "https://example-openai.openai.azure.com/openai/deployments/mock/chat/completions?api-version=2024-08-01-preview",
    apiKey: "test-key",
    requestFn: async (_url, init = {}) => {
      capturedRequestBody = JSON.parse(String(init?.body || "{}"));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: "<table><tr><td>Summary</td></tr></table>",
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(repaired, "<table><tr><td>Summary</td></tr></table>");
  assert.match(
    String(capturedRequestBody?.messages?.[0]?.content || ""),
    /you are an ocr repair agent/i,
  );
  assert.match(String(capturedRequestBody?.messages?.[1]?.content || ""), /Sum m ary/i);
});

test("extractAttachedStructuredJson maps repaired HTML (not base64 attachment) to schema", async () => {
  const { extractAttachedStructuredJson } = await import(uniqueModuleUrl());
  let capturedRequestBody = null;

  const structured = await extractAttachedStructuredJson({
    openAiUrl: "https://example-openai.openai.azure.com/openai/deployments/mock/chat/completions?api-version=2024-08-01-preview",
    apiKey: "test-key",
    repairedHtml: "<h2>Feedback Guide</h2><table><tr><td>Giving</td><td>Be direct.</td></tr></table>",
    requestFn: async (_url, init = {}) => {
      capturedRequestBody = JSON.parse(String(init?.body || "{}"));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    client: { name: "Test Client", date: "2026-06-17" },
                    core_profile: {
                      type_number: 8,
                      type_name: "Active Controller",
                      core_motivation: "To stay strong and in control.",
                      core_fear: "Being controlled by others.",
                      instinctual_subtype: { type: "SX", description: "One-on-one intensity." },
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
                  }),
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(structured?.core_profile?.type_number, 8);
  assert.match(
    String(capturedRequestBody?.messages?.[1]?.content || ""),
    /extract the required json strictly from the following repaired html report/i,
  );
  assert.match(String(capturedRequestBody?.messages?.[1]?.content || ""), /<table>/i);
  assert.doesNotMatch(String(capturedRequestBody?.messages?.[1]?.content || ""), /base64/i);
});
