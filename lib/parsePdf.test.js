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

test("parsePdf deterministically extracts scores from extracted page/section text", async () => {
  global.fetch = async (_url, init) => {
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
                type1: null,
                type2: null,
                type3: null,
                type4: null,
                type5: null,
                type6: null,
                type7: null,
                type8: null,
                type9: null,
              },
              instinctScores: { selfPreservation: null, sexual: null, social: null },
              centerScores: { head: null, heart: null, body: null },
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
                  pageNumber: 11,
                  heading: "Enneagram Profile",
                  extractedText:
                    "Type 1: 21 Type 2: 19 Type 3: 44 Type 4: 31 Type 5: 56 Type 6: 48 Type 7: 62 Type 8: 78 Type 9: 40. Instincts SX 54 SO 29 SP 17. Centers Head 25 Heart 27 Body 47.",
                  keyDataPoints: [],
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
                  sectionId: "scores",
                  sectionTitle: "Scores",
                  pageStart: 11,
                  pageEnd: 11,
                  summary: "Contains numeric chart data",
                  fullText: "Type 8 is highest at 78.",
                },
              ],
              documentSummary: "summary",
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
  assert.equal(result.typeScores.type8, 78);
  assert.equal(result.typeScores.type1, 21);
  assert.equal(result.instinctScores.sexual, 54);
  assert.equal(result.instinctScores.social, 29);
  assert.equal(result.instinctScores.selfPreservation, 17);
  assert.equal(result.centerScores.head, 25);
  assert.equal(result.centerScores.heart, 27);
  assert.equal(result.centerScores.body, 47);
});

test("parsePdf falls back to chat completions when responses API fails", async () => {
  let callNumber = 0;
  global.fetch = async (_url, _init) => {
    callNumber += 1;
    if (callNumber <= 3) {
      return {
        ok: false,
        status: 404,
        async text() {
          return callNumber === 1 ? "API version not supported" : "responses endpoint not found";
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
  assert.ok(callNumber >= 4);
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

test("parsePdf uses PDF->image fallback when chat rejects application/pdf image_url", async () => {
  const originalHook = globalThis.__parsePdfRasterizeHook;
  globalThis.__parsePdfRasterizeHook = async () => [
    "data:image/png;base64,AAAA",
    "data:image/png;base64,BBBB",
  ];

  let callNumber = 0;
  global.fetch = async (_url, init) => {
    callNumber += 1;
    const body = JSON.parse(init.body);

    if (callNumber <= 6) {
      return {
        ok: false,
        status: 400,
        async text() {
          return "API version not supported";
        },
      };
    }

    if (callNumber === 7) {
      return {
        ok: false,
        status: 404,
        async text() {
          return "Resource not found";
        },
      };
    }

    if (callNumber === 8) {
      return {
        ok: false,
        status: 400,
        async text() {
          return "Invalid image URL: unsupported MIME type 'application/pdf'";
        },
      };
    }

    const imageParts = body.messages?.[1]?.content?.filter((item) => item.type === "image_url") || [];
    const hasPngImages =
      imageParts.length >= 1 &&
      imageParts.every((item) => String(item?.image_url?.url || "").startsWith("data:image/png;base64,"));

    if (!hasPngImages) {
      return {
        ok: false,
        status: 400,
        async text() {
          return "Invalid image URL: unsupported MIME type 'application/pdf'";
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
                  clientName: "Image Fallback User",
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
                  instinctScores: { selfPreservation: 11, sexual: 22, social: 33 },
                  centerScores: { head: 40, heart: 30, body: 30 },
                }),
              },
            },
          ],
        };
      },
    };
  };

  try {
    const result = await parsePdf(Buffer.from("fake-pdf"));
    assert.equal(result.clientName, "Image Fallback User");
    assert.equal(result.typeScores.type8, 88);
  } finally {
    globalThis.__parsePdfRasterizeHook = originalHook;
  }
});
