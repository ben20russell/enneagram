const CORE_SCHEMA = {
  type: "object",
  properties: {
    clientName: { type: ["string", "null"] },
    reportDate: { type: ["string", "null"], description: "ISO format or as printed" },
    primaryType: { type: ["integer", "null"] },
    wing: { type: ["integer", "null"] },
    instinctualVariant: { type: ["string", "null"], enum: ["sp", "sx", "so", null] },
    trifix: { type: ["string", "null"] },
    typeName: { type: ["string", "null"] },
    subtypeKeyword: { type: ["string", "null"] },
    levelOfDevelopment: { type: ["integer", "null"] },
    integrationLevel: { type: ["string", "null"] },
    centreOfIntelligence: { type: ["string", "null"], enum: ["Head", "Heart", "Body", null] },
    connectedLineA: { type: ["string", "null"] },
    connectedLineB: { type: ["string", "null"] },
    coreFear: { type: ["string", "null"] },
    coreDesire: { type: ["string", "null"] },
    passion: { type: ["string", "null"] },
    worldview: { type: ["string", "null"] },
    focusOfAttention: { type: ["string", "null"] },
    selfTalk: { type: ["string", "null"] },
    metaMessage: { type: ["string", "null"] },
    typeScores: {
      type: "object",
      properties: {
        type1: { type: ["integer", "null"] },
        type2: { type: ["integer", "null"] },
        type3: { type: ["integer", "null"] },
        type4: { type: ["integer", "null"] },
        type5: { type: ["integer", "null"] },
        type6: { type: ["integer", "null"] },
        type7: { type: ["integer", "null"] },
        type8: { type: ["integer", "null"] },
        type9: { type: ["integer", "null"] },
      },
      required: ["type1", "type2", "type3", "type4", "type5", "type6", "type7", "type8", "type9"],
      additionalProperties: false,
    },
    instinctScores: {
      type: "object",
      properties: {
        selfPreservation: { type: ["integer", "null"] },
        sexual: { type: ["integer", "null"] },
        social: { type: ["integer", "null"] },
      },
      required: ["selfPreservation", "sexual", "social"],
      additionalProperties: false,
    },
    centerScores: {
      type: "object",
      properties: {
        head: { type: ["integer", "null"] },
        heart: { type: ["integer", "null"] },
        body: { type: ["integer", "null"] },
      },
      required: ["head", "heart", "body"],
      additionalProperties: false,
    },
    reportSummary: { type: ["string", "null"] },
  },
  required: [
    "clientName",
    "reportDate",
    "primaryType",
    "wing",
    "instinctualVariant",
    "trifix",
    "typeName",
    "subtypeKeyword",
    "levelOfDevelopment",
    "integrationLevel",
    "centreOfIntelligence",
    "connectedLineA",
    "connectedLineB",
    "coreFear",
    "coreDesire",
    "passion",
    "worldview",
    "focusOfAttention",
    "selfTalk",
    "metaMessage",
    "typeScores",
    "instinctScores",
    "centerScores",
    "reportSummary",
  ],
  additionalProperties: false,
};

const PAGES_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pageNumber: { type: "integer" },
          heading: { type: ["string", "null"] },
          extractedText: { type: ["string", "null"] },
          keyDataPoints: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["pageNumber", "heading", "extractedText", "keyDataPoints"],
        additionalProperties: false,
      },
    },
  },
  required: ["pages"],
  additionalProperties: false,
};

const SECTIONS_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sectionId: { type: "string" },
          sectionTitle: { type: "string" },
          pageStart: { type: ["integer", "null"] },
          pageEnd: { type: ["integer", "null"] },
          summary: { type: ["string", "null"] },
          fullText: { type: ["string", "null"] },
        },
        required: ["sectionId", "sectionTitle", "pageStart", "pageEnd", "summary", "fullText"],
        additionalProperties: false,
      },
    },
    documentSummary: { type: ["string", "null"] },
  },
  required: ["sections", "documentSummary"],
  additionalProperties: false,
};

const SCORE_RESCUE_SCHEMA = {
  type: "object",
  properties: {
    typeScores: CORE_SCHEMA.properties.typeScores,
    instinctScores: CORE_SCHEMA.properties.instinctScores,
    centerScores: CORE_SCHEMA.properties.centerScores,
  },
  required: ["typeScores", "instinctScores", "centerScores"],
  additionalProperties: false,
};

const CORE_SYSTEM_PROMPT = `You are an expert Enneagram data analyst. I am providing you with a complete iEQ9 Enneagram report in PDF format.
Your task is to visually analyze the charts, graphs, and text within this document to extract the client's complete profile.
Pay special attention to visual bar charts and radar graphs to determine exact numeric scores.
If a specific score or data point is truly missing from the report, use null.
Return ONLY a valid JSON object matching the provided schema.`;

const PAGE_PASS_PROMPT = `Perform a page-by-page extraction for the entire iEQ9 report.
For each page, return:
- page number
- heading/title if visible
- extractedText (major visible text from that page)
- keyDataPoints (important values found on that page)
Return strict JSON.`;

const SECTION_PASS_PROMPT = `Perform a section-by-section extraction for the entire iEQ9 report.
Group content into meaningful report sections (core type, subtype/instincts, centers, wings, integration, leadership, communication, strain, development).
For each section return section id/title, page range, summary, and full text block.
Return strict JSON.`;

const SCORE_RESCUE_PROMPT = `Focus ONLY on chart-extracted numeric values.
Read the visual bar charts/radar charts in this iEQ9 report and return strict JSON with:
- typeScores.type1..type9
- instinctScores.selfPreservation, sexual, social
- centerScores.head, heart, body
Use null only when truly unreadable or absent.`;

const BASE_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const MAX_RETRIES = 5;

function getEmptyParsedResult() {
  return {
    clientName: null,
    reportDate: null,
    primaryType: null,
    wing: null,
    instinctualVariant: null,
    trifix: null,
    typeName: null,
    subtypeKeyword: null,
    levelOfDevelopment: null,
    integrationLevel: null,
    centreOfIntelligence: null,
    connectedLineA: null,
    connectedLineB: null,
    coreFear: null,
    coreDesire: null,
    passion: null,
    worldview: null,
    focusOfAttention: null,
    selfTalk: null,
    metaMessage: null,
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
    instinctScores: {
      selfPreservation: null,
      sexual: null,
      social: null,
    },
    centerScores: {
      head: null,
      heart: null,
      body: null,
    },
    reportSummary: null,
    reportContent: {
      pages: [],
      sections: [],
      documentSummary: null,
    },
  };
}

function normalizeParsedShape(raw) {
  const base = getEmptyParsedResult();
  if (!raw || typeof raw !== "object") {
    return base;
  }
  return {
    ...base,
    ...raw,
    typeScores: { ...base.typeScores, ...(raw.typeScores || {}) },
    instinctScores: { ...base.instinctScores, ...(raw.instinctScores || {}) },
    centerScores: { ...base.centerScores, ...(raw.centerScores || {}) },
    reportContent: {
      pages: Array.isArray(raw?.reportContent?.pages) ? raw.reportContent.pages : [],
      sections: Array.isArray(raw?.reportContent?.sections) ? raw.reportContent.sections : [],
      documentSummary: raw?.reportContent?.documentSummary ?? null,
    },
  };
}

function safeJsonParse(raw) {
  if (typeof raw === "object" && raw !== null) {
    return raw;
  }
  const cleaned = String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function parseResponsesJson(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return safeJsonParse(data.output_text);
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;
    for (const part of item.content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return safeJsonParse(part.text);
      }
    }
  }

  throw new Error("Azure OpenAI parse failed: unexpected responses API shape");
}

function parseChatCompletionsJson(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return safeJsonParse(content);
  }
  if (Array.isArray(content)) {
    const firstText = content.find((part) => typeof part?.text === "string")?.text;
    if (!firstText) {
      throw new Error("Azure OpenAI parse failed: response content was empty");
    }
    return safeJsonParse(firstText);
  }
  if (content && typeof content === "object") {
    return content;
  }
  throw new Error("Azure OpenAI parse failed: unexpected chat completion response shape");
}

function jitterDelayMs(baseMs) {
  const factor = 1 + (Math.random() * 0.4 - 0.2);
  return Math.max(1, Math.round(baseMs * factor));
}

function isTransientStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isTransientError(error) {
  const status = Number(error?.status || 0);
  if (isTransientStatus(status)) return true;
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("stream disconnected before completion") ||
    message.includes("etimedout") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("network")
  );
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAzureWithRetry(url, apiKey, payload) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const error = new Error(`Azure OpenAI parse failed (${response.status}): ${errorBody.slice(0, 500)}`);
        error.status = response.status;
        throw error;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES || !isTransientError(error)) {
        throw error;
      }
      const baseDelay = BASE_DELAYS_MS[Math.min(attempt - 1, BASE_DELAYS_MS.length - 1)];
      const delay = jitterDelayMs(baseDelay);
      console.log(
        `[parsePdf retry] attempt=${attempt}/${MAX_RETRIES} delayMs=${delay} errorClass=${
          error?.status || error?.name || "UnknownError"
        }`,
      );
      await sleep(delay);
    }
  }
  throw lastError || new Error("Azure OpenAI parse failed: unknown retry failure");
}

export function buildAzureResponsesUrl(endpoint, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

function buildAzureResponsesApiUrl(endpoint, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/v1/responses?api-version=${encodeURIComponent(apiVersion)}`;
}

function buildAzureDeploymentChatUrl(endpoint, deployment, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

function candidateApiVersions(preferredApiVersion) {
  return Array.from(
    new Set([
      String(preferredApiVersion || "").trim(),
      "2025-04-01-preview",
      "2024-10-21",
    ].filter(Boolean)),
  );
}

function isUnsupportedApiVersionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("api version not supported");
}

function buildResponsesPayload({ model, systemPrompt, userPrompt, schema, pdfDataUrl, maxOutputTokens = 5000 }) {
  return {
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: userPrompt },
          { type: "input_file", filename: "report.pdf", file_data: pdfDataUrl },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "enneagram_report_schema",
        strict: true,
        schema,
      },
    },
    max_output_tokens: maxOutputTokens,
    temperature: 0.1,
  };
}

async function runResponsesPass({ endpoint, apiKey, apiVersion, deployment, systemPrompt, userPrompt, schema, pdfDataUrl, maxOutputTokens }) {
  let lastError = null;
  for (const version of candidateApiVersions(apiVersion)) {
    try {
      const url = buildAzureResponsesApiUrl(endpoint, version);
      const payload = buildResponsesPayload({
        model: deployment,
        systemPrompt,
        userPrompt,
        schema,
        pdfDataUrl,
        maxOutputTokens,
      });
      const data = await callAzureWithRetry(url, apiKey, payload);
      return parseResponsesJson(data);
    } catch (error) {
      lastError = error;
      if (!isUnsupportedApiVersionError(error)) {
        throw error;
      }
      console.log("[parsePdf] responses pass api-version unsupported, trying next candidate", {
        attemptedApiVersion: version,
      });
    }
  }
  throw lastError || new Error("Azure OpenAI parse failed: no supported API version found");
}

async function runCorePass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }) {
  const parsed = await runResponsesPass({
    endpoint,
    apiKey,
    apiVersion,
    deployment,
    systemPrompt: CORE_SYSTEM_PROMPT,
    userPrompt: "Extract all structured iEQ9 profile fields from this report.",
    schema: CORE_SCHEMA,
    pdfDataUrl,
    maxOutputTokens: 7000,
  });
  return normalizeParsedShape(parsed);
}

async function runPagesPass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }) {
  return runResponsesPass({
    endpoint,
    apiKey,
    apiVersion,
    deployment,
    systemPrompt: PAGE_PASS_PROMPT,
    userPrompt: "Return page-by-page extraction for all report pages.",
    schema: PAGES_SCHEMA,
    pdfDataUrl,
    maxOutputTokens: 12000,
  });
}

async function runSectionsPass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }) {
  return runResponsesPass({
    endpoint,
    apiKey,
    apiVersion,
    deployment,
    systemPrompt: SECTION_PASS_PROMPT,
    userPrompt: "Return section-by-section extraction for the full report.",
    schema: SECTIONS_SCHEMA,
    pdfDataUrl,
    maxOutputTokens: 12000,
  });
}

async function runScoreRescuePass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }) {
  return runResponsesPass({
    endpoint,
    apiKey,
    apiVersion,
    deployment,
    systemPrompt: SCORE_RESCUE_PROMPT,
    userPrompt: "Return chart-only numeric scores in strict schema.",
    schema: SCORE_RESCUE_SCHEMA,
    pdfDataUrl,
    maxOutputTokens: 1800,
  });
}

function hasAllNullScores(scores) {
  if (!scores || typeof scores !== "object") return true;
  const values = Object.values(scores);
  if (!values.length) return true;
  return values.every((value) => value == null);
}

function needsScoreRescue(parsed) {
  return (
    hasAllNullScores(parsed?.typeScores) ||
    hasAllNullScores(parsed?.instinctScores) ||
    hasAllNullScores(parsed?.centerScores)
  );
}

function mergeReportContent(baseParsed, pagesPayload, sectionsPayload) {
  const merged = normalizeParsedShape(baseParsed);
  const pages = Array.isArray(pagesPayload?.pages) ? pagesPayload.pages : [];
  const sections = Array.isArray(sectionsPayload?.sections) ? sectionsPayload.sections : [];
  merged.reportContent = {
    pages,
    sections,
    documentSummary: sectionsPayload?.documentSummary ?? merged.reportSummary ?? null,
  };
  if (!merged.reportSummary && merged.reportContent.documentSummary) {
    merged.reportSummary = merged.reportContent.documentSummary;
  }
  return merged;
}

function mergeWithRescuedScores(parsed, rescuedScores) {
  return normalizeParsedShape({
    ...parsed,
    typeScores: {
      ...(parsed?.typeScores || {}),
      ...(rescuedScores?.typeScores || {}),
    },
    instinctScores: {
      ...(parsed?.instinctScores || {}),
      ...(rescuedScores?.instinctScores || {}),
    },
    centerScores: {
      ...(parsed?.centerScores || {}),
      ...(rescuedScores?.centerScores || {}),
    },
  });
}

async function parseViaChatCompletions({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }) {
  const payload = {
    messages: [
      { role: "system", content: CORE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all data from this iEQ9 report into the requested schema." },
          { type: "image_url", image_url: { url: pdfDataUrl } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "enneagram_report_schema",
        strict: true,
        schema: CORE_SCHEMA,
      },
    },
    max_tokens: 7000,
    temperature: 0.1,
  };
  const legacyUrl = buildAzureDeploymentChatUrl(endpoint, deployment, apiVersion);
  try {
    const data = await callAzureWithRetry(legacyUrl, apiKey, payload);
    return normalizeParsedShape(parseChatCompletionsJson(data));
  } catch (legacyError) {
    console.log("[parsePdf] legacy deployment chat endpoint failed, trying model-based chat endpoint", {
      details: String(legacyError?.message || legacyError),
    });
    const modelUrl = buildAzureResponsesUrl(endpoint, apiVersion);
    const data = await callAzureWithRetry(modelUrl, apiKey, { ...payload, model: deployment });
    return normalizeParsedShape(parseChatCompletionsJson(data));
  }
}

export async function parsePdf(pdfBuffer) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || "";
  const apiKey = process.env.AZURE_OPENAI_API_KEY || "";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4o";

  if (!endpoint || !apiKey || !deployment) {
    throw new Error("Missing Azure OpenAI environment variables.");
  }

  const base64Pdf = Buffer.from(pdfBuffer).toString("base64");
  const pdfDataUrl = `data:application/pdf;base64,${base64Pdf}`;

  let parsed = null;
  try {
    parsed = await runCorePass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl });
    console.log("[parsePdf] Core pass succeeded");

    const [pagesPayload, sectionsPayload] = await Promise.all([
      runPagesPass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }).catch((error) => {
        console.log("[parsePdf] Page pass failed", { details: String(error?.message || error) });
        return { pages: [] };
      }),
      runSectionsPass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }).catch((error) => {
        console.log("[parsePdf] Section pass failed", { details: String(error?.message || error) });
        return { sections: [], documentSummary: null };
      }),
    ]);

    parsed = mergeReportContent(parsed, pagesPayload, sectionsPayload);
  } catch (responsesError) {
    console.log("[parsePdf] responses passes failed, falling back to chat_completions", {
      details: String(responsesError?.message || responsesError),
    });
    parsed = await parseViaChatCompletions({
      endpoint,
      apiKey,
      apiVersion,
      deployment,
      pdfDataUrl,
    });
  }

  if (needsScoreRescue(parsed)) {
    try {
      const rescued = await runScoreRescuePass({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        pdfDataUrl,
      });
      parsed = mergeWithRescuedScores(parsed, rescued);
      console.log("[parsePdf] Applied score rescue pass");
    } catch (rescueError) {
      console.log("[parsePdf] Score rescue pass failed", {
        details: String(rescueError?.message || rescueError),
      });
    }
  }

  return normalizeParsedShape(parsed);
}
