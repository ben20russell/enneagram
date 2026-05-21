import test from "node:test";
import assert from "node:assert/strict";

process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
process.env.AZURE_OPENAI_API_KEY = "test-key";
process.env.AZURE_OPENAI_API_VERSION = "2024-02-15-preview";
process.env.AZURE_OPENAI_DEPLOYMENT_NAME = "gpt-4o";

const { parsePdf, buildAzureResponsesUrl } = await import("../lib/parsePdf.js");

test("buildAzureResponsesUrl builds chat completions url from bare endpoint", () => {
  assert.equal(
    buildAzureResponsesUrl("https://example.openai.azure.com/", "2024-02-15-preview"),
    "https://example.openai.azure.com/openai/chat/completions?api-version=2024-02-15-preview",
  );
});

test("parsePdf runs multi-pass extraction and returns content blocks", async () => {
  const calls = [];
  global.fetch = async (_url, init) => {
    calls.push({ init });
    const requestBody = JSON.parse(init.body);
    const promptText = requestBody?.input?.[0]?.content?.[0]?.text || "";

    if (promptText.includes("expert Enneagram data analyst")) {
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              clientName: "Ben Russell",
              primaryType: 8,
              typeScores: {
                type1: 11,
                type2: 22,
                type3: 33,
                type4: 44,
                type5: 55,
                type6: 66,
                type7: 77,
                type8: 88,
                type9: 99,
              },
              instinctScores: { selfPreservation: 10, sexual: 70, social: 20 },
              centerScores: { head: 20, heart: 30, body: 50 },
            }),
          };
        },
      };
    }

    if (promptText.includes("page-by-page extraction")) {
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              pages: [
                {
                  pageNumber: 1,
                  heading: "Cover",
                  extractedText: "Ben Russell ...",
                  keyDataPoints: ["clientName: Ben Russell"],
                },
              ],
            }),
          };
        },
      };
    }

    if (promptText.includes("section-by-section extraction")) {
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              sections: [
                {
                  sectionId: "core_type",
                  sectionTitle: "Core Enneagram Type",
                  pageStart: 6,
                  pageEnd: 8,
                  summary: "Type 8 summary",
                  fullText: "Long section text",
                },
              ],
              documentSummary: "Overall report summary",
            }),
          };
        },
      };
    }

    return {
      ok: false,
      status: 400,
      async text() {
        return "unexpected prompt";
      },
    };
  };

  const result = await parsePdf(Buffer.from("fake-pdf-content"));
  assert.equal(result.clientName, "Ben Russell");
  assert.equal(result.primaryType, 8);
  assert.equal(result.typeScores.type8, 88);
  assert.equal(result.reportContent.pages.length, 1);
  assert.equal(result.reportContent.sections.length, 1);
  assert.equal(result.reportContent.documentSummary, "Overall report summary");

  assert.ok(calls.length >= 3);
  const firstBody = JSON.parse(calls[0].init.body);
  assert.equal(firstBody.input[1].content[1].type, "input_file");
  assert.match(firstBody.input[1].content[1].file_data, /^data:application\/pdf;base64,/);
  assert.equal(firstBody.text.format.type, "json_schema");
});

test("parsePdf falls back to chat completions when responses API fails", async () => {
  let callNumber = 0;
  global.fetch = async (_url, _init) => {
    callNumber += 1;
    if (callNumber === 1) {
      return {
        ok: false,
        status: 404,
        async text() {
          return "responses endpoint not found";
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
                  clientName: "Fallback User",
                  primaryType: 7,
                  typeScores: {
                    type1: 10,
                    type2: 20,
                    type3: 30,
                    type4: 40,
                    type5: 50,
                    type6: 60,
                    type7: 70,
                    type8: 80,
                    type9: 90,
                  },
                  instinctScores: { selfPreservation: 30, sexual: 50, social: 20 },
                  centerScores: { head: 40, heart: 30, body: 30 },
                }),
              },
            },
          ],
        };
      },
    };
  };

  const result = await parsePdf(Buffer.from("fake"));
  assert.equal(result.clientName, "Fallback User");
  assert.equal(result.primaryType, 7);
  assert.equal(callNumber, 2);
});

test("parsePdf surfaces Azure error payload details", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 400,
    async text() {
      return "bad request details";
    },
  });

  await assert.rejects(
    () => parsePdf(Buffer.from("fake")),
    /Azure OpenAI parse failed \(400\): bad request details/,
  );
});
