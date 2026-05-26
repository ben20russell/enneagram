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
  assert.ok(result.reportContent.sections.length >= 1);
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

test("parsePdf extracts Type Core Pattern lines from Typical Feeling Patterns content", async () => {
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
                type1: 21,
                type2: 19,
                type3: 44,
                type4: 31,
                type5: 56,
                type6: 48,
                type7: 62,
                type8: 78,
                type9: 40,
              },
              instinctScores: { selfPreservation: 17, sexual: 54, social: 29 },
              centerScores: { head: 25, heart: 27, body: 47 },
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
                  pageNumber: 7,
                  heading: "Typical Feeling Patterns",
                  extractedText:
                    "Typical Feeling Patterns: • As an Ennea 8 you tend to be quick to express anger and then try to channel this anger into immediate action. • While your exterior may be tough and no-nonsense, you feel emotions and are generous and kind-hearted. • Emotions like sadness and fear make you feel vulnerable and weak. • Your softer emotions only appear when you feel safe. Blind Spots: ...",
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
                  sectionId: "type_8_patterns",
                  sectionTitle: "Typical Feeling Patterns",
                  pageStart: 7,
                  pageEnd: 7,
                  summary: "Type 8 pattern bullets",
                  fullText:
                    "Typical Feeling Patterns: • As an Ennea 8 you tend to be quick to express anger and then try to channel this anger into immediate action. • While your exterior may be tough and no-nonsense, you feel emotions and are generous and kind-hearted. • Emotions like sadness and fear make you feel vulnerable and weak. • Your softer emotions only appear when you feel safe. Blind Spots: ...",
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
  assert.equal(result.corePattern?.title, "Type 8 Core Pattern");
  assert.equal(Array.isArray(result.corePattern?.lines), true);
  assert.equal(result.corePattern.lines.length, 4);
  assert.match(result.corePattern.lines[0], /quick to express anger/i);
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

test("parsePdf enriches pages with deterministic PDF text extraction when model page text is partial", async () => {
  const originalTextHook = globalThis.__parsePdfExtractTextHook;
  globalThis.__parsePdfExtractTextHook = async () => ({
    pages: [
      {
        pageNumber: 1,
        heading: "Cover",
        extractedText: "FULL PAGE TEXT FROM PDF LAYER: This report includes complete wording and not just a summary.",
        keyDataPoints: ["full-text-source:pdf-layer"],
      },
    ],
  });

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
                  extractedText: "Short summary only.",
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
                  sectionId: "summary",
                  sectionTitle: "Summary",
                  pageStart: 1,
                  pageEnd: 1,
                  summary: "Short section",
                  fullText: "Short section text",
                },
              ],
              documentSummary: "Short document summary",
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

  try {
    const result = await parsePdf(Buffer.from("fake-pdf-content"));
    assert.equal(result.reportContent.pages.length, 1);
    assert.match(result.reportContent.pages[0].extractedText, /FULL PAGE TEXT FROM PDF LAYER/i);
    assert.ok(result.reportContent.pages[0].keyDataPoints.includes("full-text-source:pdf-layer"));
  } finally {
    globalThis.__parsePdfExtractTextHook = originalTextHook;
  }
});

test("parsePdf preflight detects full page count and targets all pages for extraction", async () => {
  const originalPageCountHook = globalThis.__parsePdfPageCountHook;
  const originalRasterizeHook = globalThis.__parsePdfRasterizeHook;
  const originalTextHook = globalThis.__parsePdfExtractTextHook;
  const originalMinPages = process.env.PDF_PARSE_MIN_PAGES;
  process.env.PDF_PARSE_MIN_PAGES = "20";

  const rasterizedBatches = [];
  globalThis.__parsePdfPageCountHook = async () => 42;
  globalThis.__parsePdfRasterizeHook = async (_pdfBuffer, options = {}) => {
    const pageNumbers = Array.isArray(options?.pageNumbers) ? options.pageNumbers : [];
    rasterizedBatches.push(pageNumbers);
    return pageNumbers.map((pageNumber) => `data:image/png;base64,PAGE_${pageNumber}`);
  };
  globalThis.__parsePdfExtractTextHook = async () => ({
    pages: Array.from({ length: 42 }, (_value, index) => {
      const pageNumber = index + 1;
      return {
        pageNumber,
        heading: `Page ${pageNumber}`,
        extractedText: `Full PDF text for page ${pageNumber}`,
        keyDataPoints: [`page:${pageNumber}`],
      };
    }),
  });

  global.fetch = async (_url, init) => {
    const requestBody = JSON.parse(init.body);
    const responsesPrompt = requestBody?.input?.[0]?.content?.[0]?.text || "";
    const chatPrompt =
      requestBody?.messages?.[1]?.content?.find((part) => part?.type === "text")?.text || "";

    if (responsesPrompt.includes("expert Enneagram data analyst")) {
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

    if (chatPrompt.includes("These images are report pages in this exact order and page numbers:")) {
      const pageNumbers = Array.from(
        new Set((chatPrompt.match(/\d+/g) || []).map((value) => Number(value)).filter((value) => value > 0)),
      );
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    pages: pageNumbers.map((pageNumber) => ({
                      pageNumber,
                      heading: `Extracted page ${pageNumber}`,
                      extractedText: `Image extracted text for page ${pageNumber}`,
                      keyDataPoints: [`image-page:${pageNumber}`],
                    })),
                  }),
                },
              },
            ],
          };
        },
      };
    }

    if (chatPrompt.includes("Build section-by-section extraction using the following page content")) {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    sections: [
                      {
                        sectionId: "overview",
                        sectionTitle: "Overview",
                        pageStart: 1,
                        pageEnd: 8,
                        summary: "overview",
                        fullText: "overview text",
                      },
                      {
                        sectionId: "type",
                        sectionTitle: "Type",
                        pageStart: 9,
                        pageEnd: 16,
                        summary: "type",
                        fullText: "type text",
                      },
                      {
                        sectionId: "instinct",
                        sectionTitle: "Instinct",
                        pageStart: 17,
                        pageEnd: 24,
                        summary: "instinct",
                        fullText: "instinct text",
                      },
                      {
                        sectionId: "centers",
                        sectionTitle: "Centers",
                        pageStart: 25,
                        pageEnd: 32,
                        summary: "centers",
                        fullText: "centers text",
                      },
                      {
                        sectionId: "summary",
                        sectionTitle: "Summary",
                        pageStart: 33,
                        pageEnd: 42,
                        summary: "summary",
                        fullText: "summary text",
                      },
                    ],
                    documentSummary: "full report summary",
                  }),
                },
              },
            ],
          };
        },
      };
    }

    if (responsesPrompt.includes("page-by-page extraction")) {
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              pages: [],
            }),
          };
        },
      };
    }

    if (responsesPrompt.includes("section-by-section extraction")) {
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              sections: [],
              documentSummary: null,
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

  try {
    const result = await parsePdf(Buffer.from("fake-pdf-content"));
    assert.equal(result._parseDiagnostics?.extraction?.detectedTotalPages, 42);
    assert.equal(result._parseDiagnostics?.extraction?.minExpectedPages, 42);
    assert.equal(result.reportContent.pages.length, 42);
    assert.ok(rasterizedBatches.length >= 14);
    assert.ok(rasterizedBatches.flat().includes(42));
  } finally {
    globalThis.__parsePdfPageCountHook = originalPageCountHook;
    globalThis.__parsePdfRasterizeHook = originalRasterizeHook;
    globalThis.__parsePdfExtractTextHook = originalTextHook;
    process.env.PDF_PARSE_MIN_PAGES = originalMinPages;
  }
});

test("parsePdf score rescue maps qualitative center levels to numeric values", async () => {
  const originalPageCountHook = globalThis.__parsePdfPageCountHook;
  const originalRasterizeHook = globalThis.__parsePdfRasterizeHook;
  const originalTextHook = globalThis.__parsePdfExtractTextHook;
  const originalMinPages = process.env.PDF_PARSE_MIN_PAGES;
  process.env.PDF_PARSE_MIN_PAGES = "1";

  globalThis.__parsePdfPageCountHook = async () => 1;
  globalThis.__parsePdfRasterizeHook = async (_pdfBuffer, options = {}) => {
    const pageNumbers = Array.isArray(options?.pageNumbers) && options.pageNumbers.length ? options.pageNumbers : [1];
    return pageNumbers.map((pageNumber) => `data:image/png;base64,PAGE_${pageNumber}`);
  };
  globalThis.__parsePdfExtractTextHook = async () => ({
    pages: [
      {
        pageNumber: 1,
        heading: "Scores",
        extractedText: "Chart page without reliable numeric labels.",
        keyDataPoints: [],
      },
    ],
  });

  global.fetch = async (_url, init) => {
    const requestBody = JSON.parse(init.body);
    const responsesPrompt = requestBody?.input?.[0]?.content?.[0]?.text || "";
    const chatPrompt =
      requestBody?.messages?.[1]?.content?.find((part) => part?.type === "text")?.text || "";

    if (responsesPrompt.includes("expert Enneagram data analyst")) {
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              clientName: "Score Rescue User",
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

    if (chatPrompt.includes("These images are report pages in this exact order and page numbers:")) {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    pages: [
                      {
                        pageNumber: 1,
                        heading: "Charts",
                        extractedText: "Visual chart page",
                        keyDataPoints: [],
                      },
                    ],
                  }),
                },
              },
            ],
          };
        },
      };
    }

    if (chatPrompt.includes("Build section-by-section extraction using the following page content")) {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    sections: [
                      { sectionId: "s1", sectionTitle: "s1", pageStart: 1, pageEnd: 1, summary: "s1", fullText: "s1" },
                      { sectionId: "s2", sectionTitle: "s2", pageStart: 1, pageEnd: 1, summary: "s2", fullText: "s2" },
                      { sectionId: "s3", sectionTitle: "s3", pageStart: 1, pageEnd: 1, summary: "s3", fullText: "s3" },
                      { sectionId: "s4", sectionTitle: "s4", pageStart: 1, pageEnd: 1, summary: "s4", fullText: "s4" },
                      { sectionId: "s5", sectionTitle: "s5", pageStart: 1, pageEnd: 1, summary: "s5", fullText: "s5" },
                    ],
                    documentSummary: "summary",
                  }),
                },
              },
            ],
          };
        },
      };
    }

    if (chatPrompt.includes("Read these chart pages") || chatPrompt.includes("Type Scores")) {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
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
                    instinctScores: { selfPreservation: 17, sexual: 54, social: 29 },
                    centerScores: { head: "High", heart: "Medium", body: "Low" },
                  }),
                },
              },
            ],
          };
        },
      };
    }

    if (responsesPrompt.includes("page-by-page extraction")) {
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify({ pages: [] }) };
        },
      };
    }

    if (responsesPrompt.includes("section-by-section extraction")) {
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify({ sections: [], documentSummary: null }) };
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

  try {
    const result = await parsePdf(Buffer.from("fake-pdf-content"));
    assert.equal(result.centerScores.head, 80);
    assert.equal(result.centerScores.heart, 55);
    assert.equal(result.centerScores.body, 25);
  } finally {
    globalThis.__parsePdfPageCountHook = originalPageCountHook;
    globalThis.__parsePdfRasterizeHook = originalRasterizeHook;
    globalThis.__parsePdfExtractTextHook = originalTextHook;
    process.env.PDF_PARSE_MIN_PAGES = originalMinPages;
  }
});

test("parsePdf keeps full page coverage when one image batch fails by retrying missing pages individually", async () => {
  const originalPageCountHook = globalThis.__parsePdfPageCountHook;
  const originalRasterizeHook = globalThis.__parsePdfRasterizeHook;
  const originalTextHook = globalThis.__parsePdfExtractTextHook;
  const originalMinPages = process.env.PDF_PARSE_MIN_PAGES;
  process.env.PDF_PARSE_MIN_PAGES = "1";

  globalThis.__parsePdfPageCountHook = async () => 6;
  globalThis.__parsePdfRasterizeHook = async (_pdfBuffer, options = {}) => {
    const pageNumbers = Array.isArray(options?.pageNumbers) && options.pageNumbers.length ? options.pageNumbers : [1];
    return pageNumbers.map((pageNumber) => `data:image/png;base64,PAGE_${pageNumber}`);
  };
  globalThis.__parsePdfExtractTextHook = async () => ({ pages: [] });

  global.fetch = async (_url, init) => {
    const requestBody = JSON.parse(init.body);
    const responsesPrompt = requestBody?.input?.[0]?.content?.[0]?.text || "";
    const chatPrompt =
      requestBody?.messages?.[1]?.content?.find((part) => part?.type === "text")?.text || "";

    if (responsesPrompt.includes("expert Enneagram data analyst")) {
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              clientName: "Batch Retry User",
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
              instinctScores: { selfPreservation: 17, sexual: 54, social: 29 },
              centerScores: { head: 25, heart: 27, body: 47 },
            }),
          };
        },
      };
    }

    if (chatPrompt.includes("These images are report pages in this exact order and page numbers:")) {
      if (chatPrompt.includes("1, 2, 3")) {
        return {
          ok: true,
          async json() {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      pages: [
                        { pageNumber: 1, heading: "P1", extractedText: "text 1", keyDataPoints: [] },
                        { pageNumber: 2, heading: "P2", extractedText: "text 2", keyDataPoints: [] },
                        { pageNumber: 3, heading: "P3", extractedText: "text 3", keyDataPoints: [] },
                      ],
                    }),
                  },
                },
              ],
            };
          },
        };
      }
      if (chatPrompt.includes("4, 5, 6")) {
        return {
          ok: false,
          status: 400,
          async text() {
            return "simulated batch failure";
          },
        };
      }
    }

    if (chatPrompt.includes("Extract this single page. Its pageNumber is exactly")) {
      const pageNumber = Number((chatPrompt.match(/exactly\s+(\d+)/i) || [])[1] || 0);
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    pages: [
                      {
                        pageNumber,
                        heading: `P${pageNumber}`,
                        extractedText: `text ${pageNumber}`,
                        keyDataPoints: [],
                      },
                    ],
                  }),
                },
              },
            ],
          };
        },
      };
    }

    if (chatPrompt.includes("Build section-by-section extraction using the following page content")) {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    sections: [
                      { sectionId: "s1", sectionTitle: "s1", pageStart: 1, pageEnd: 2, summary: "s1", fullText: "s1" },
                      { sectionId: "s2", sectionTitle: "s2", pageStart: 3, pageEnd: 4, summary: "s2", fullText: "s2" },
                      { sectionId: "s3", sectionTitle: "s3", pageStart: 5, pageEnd: 6, summary: "s3", fullText: "s3" },
                      { sectionId: "s4", sectionTitle: "s4", pageStart: 1, pageEnd: 6, summary: "s4", fullText: "s4" },
                      { sectionId: "s5", sectionTitle: "s5", pageStart: 1, pageEnd: 6, summary: "s5", fullText: "s5" },
                    ],
                    documentSummary: "summary",
                  }),
                },
              },
            ],
          };
        },
      };
    }

    if (responsesPrompt.includes("page-by-page extraction")) {
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              pages: [
                { pageNumber: 1, heading: "fallback-1", extractedText: "fallback 1", keyDataPoints: [] },
                { pageNumber: 2, heading: "fallback-2", extractedText: "fallback 2", keyDataPoints: [] },
              ],
            }),
          };
        },
      };
    }

    if (responsesPrompt.includes("section-by-section extraction")) {
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify({ sections: [], documentSummary: null }) };
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

  try {
    const result = await parsePdf(Buffer.from("fake-pdf-content"));
    assert.equal(result.reportContent.pages.length, 6);
    assert.deepEqual(
      result.reportContent.pages.map((page) => page.pageNumber),
      [1, 2, 3, 4, 5, 6],
    );
  } finally {
    globalThis.__parsePdfPageCountHook = originalPageCountHook;
    globalThis.__parsePdfRasterizeHook = originalRasterizeHook;
    globalThis.__parsePdfExtractTextHook = originalTextHook;
    process.env.PDF_PARSE_MIN_PAGES = originalMinPages;
  }
});
