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
