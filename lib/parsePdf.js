const SCHEMA = {
  type: "object",
  properties: {
    clientName: { type: ["string", "null"] },
    reportDate: { type: ["string", "null"], description: "ISO format or as printed" },
    primaryType: { type: ["integer", "null"] },
    wing: { type: ["integer", "null"] },
    instinctualVariant: { type: ["string", "null"], enum: ["sp", "sx", "so", null] },
    trifix: { type: ["string", "null"] },
    levelOfDevelopment: { type: ["integer", "null"] },
    centreOfIntelligence: { type: ["string", "null"], enum: ["Head", "Heart", "Body", null] },
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
    "levelOfDevelopment",
    "centreOfIntelligence",
    "typeScores",
    "instinctScores",
    "centerScores",
    "reportSummary",
  ],
  additionalProperties: false,
};

const SCORE_RESCUE_SCHEMA = {
  type: "object",
  properties: {
    typeScores: SCHEMA.properties.typeScores,
    instinctScores: SCHEMA.properties.instinctScores,
    centerScores: SCHEMA.properties.centerScores,
  },
  required: ["typeScores", "instinctScores", "centerScores"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are an expert Enneagram data analyst. I am providing you with a complete iEQ9 Enneagram report in PDF format.
Your task is to visually analyze the charts, graphs, and text within this document to extract the client's complete profile.
Pay special attention to visual bar charts and radar graphs to determine exact numeric scores.
If a specific score or data point is truly missing from the report, use null.
Return ONLY a valid JSON object matching the provided schema.`;

const SCORE_RESCUE_PROMPT = `Focus ONLY on chart-extracted numeric values.
Read the visual bar charts/radar charts in this iEQ9 report and return strict JSON with:
- typeScores.type1..type9
- instinctScores.selfPreservation, sexual, social
- centerScores.head, heart, body
Use null only when truly unreadable or absent.`;

const BASE_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const MAX_RETRIES = 5;

function getEmptySchema() {
  return {
    clientName: null,
    reportDate: null,
    primaryType: null,
    wing: null,
    instinctualVariant: null,
    trifix: null,
    levelOfDevelopment: null,
    centreOfIntelligence: null,
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
  };
}

function normalizeParsedShape(raw) {
  const base = getEmptySchema();
  if (!raw || typeof raw !== "object") {
    return base;
  }
  return {
    ...base,
    ...raw,
    typeScores: { ...base.typeScores, ...(raw.typeScores || {}) },
    instinctScores: { ...base.instinctScores, ...(raw.instinctScores || {}) },
    centerScores: { ...base.centerScores, ...(raw.centerScores || {}) },
  };
}

export function buildAzureResponsesUrl(endpoint, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

function buildAzureResponsesApiUrl(endpoint, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/v1/responses?api-version=${encodeURIComponent(apiVersion)}`;
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

function mergeWithRescuedScores(parsed, rescuedScores) {
  if (!rescuedScores || typeof rescuedScores !== "object") return parsed;
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

async function parseViaResponsesApi({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }) {
  const url = buildAzureResponsesApiUrl(endpoint, apiVersion);
  const payload = {
    model: deployment,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Extract all data from this iEQ9 report into the requested schema." },
          { type: "input_file", filename: "report.pdf", file_data: pdfDataUrl },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "enneagram_report_schema",
        strict: true,
        schema: SCHEMA,
      },
    },
    max_output_tokens: 4000,
    temperature: 0.1,
  };

  const data = await callAzureWithRetry(url, apiKey, payload);
  return normalizeParsedShape(parseResponsesJson(data));
}

async function rescueScoresViaResponsesApi({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }) {
  const url = buildAzureResponsesApiUrl(endpoint, apiVersion);
  const payload = {
    model: deployment,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: SCORE_RESCUE_PROMPT }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Return only chart numeric scores using the provided schema." },
          { type: "input_file", filename: "report.pdf", file_data: pdfDataUrl },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "enneagram_chart_scores",
        strict: true,
        schema: SCORE_RESCUE_SCHEMA,
      },
    },
    max_output_tokens: 1400,
    temperature: 0,
  };

  const data = await callAzureWithRetry(url, apiKey, payload);
  return safeJsonParse(parseResponsesJson(data));
}

async function parseViaChatCompletions({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }) {
  const url = buildAzureResponsesUrl(endpoint, apiVersion);
  const payload = {
    model: deployment,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
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
        schema: SCHEMA,
      },
    },
    max_tokens: 4000,
    temperature: 0.1,
  };

  const data = await callAzureWithRetry(url, apiKey, payload);
  return normalizeParsedShape(parseChatCompletionsJson(data));
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
    parsed = await parseViaResponsesApi({
      endpoint,
      apiKey,
      apiVersion,
      deployment,
      pdfDataUrl,
    });
    console.log("[parsePdf] Primary strategy=responses_api succeeded");
  } catch (responsesError) {
    console.log("[parsePdf] responses_api failed, falling back to chat_completions", {
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
      const rescued = await rescueScoresViaResponsesApi({
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
