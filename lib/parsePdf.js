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

const PAGE_BATCH_SCHEMA = {
  type: "object",
  properties: {
    pages: PAGES_SCHEMA.properties.pages,
  },
  required: ["pages"],
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
    corePattern: {
      title: null,
      lines: [],
      source: null,
    },
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
    corePattern: {
      title: raw?.corePattern?.title ?? null,
      lines: Array.isArray(raw?.corePattern?.lines)
        ? raw.corePattern.lines.filter((line) => typeof line === "string")
        : [],
      source: raw?.corePattern?.source ?? null,
    },
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
  const timeoutMs = Number(process.env.AZURE_OPENAI_REQUEST_TIMEOUT_MS || 600000);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify(payload),
        });
      } finally {
        clearTimeout(timeout);
      }

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

function buildAzureResponsesApiUrlLegacy(endpoint, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/responses?api-version=${encodeURIComponent(apiVersion)}`;
}

function buildAzureDeploymentChatUrl(endpoint, deployment, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

function candidateApiVersions(preferredApiVersion) {
  return Array.from(
    new Set([
      String(preferredApiVersion || "").trim(),
      "2025-05-01-preview",
      "2025-04-01-preview",
      "2025-03-01-preview",
      "2024-12-01-preview",
      "2024-10-21",
      "2024-08-01-preview",
      "2024-06-01",
      "2024-05-01-preview",
      "2024-02-15-preview",
    ].filter(Boolean)),
  );
}

function isUnsupportedApiVersionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("api version not supported") ||
    message.includes("enabled only for api-version")
  );
}

function isPdfMimeUnsupportedForImageUrlError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("invalid image url") &&
    message.includes("unsupported mime type") &&
    message.includes("application/pdf")
  );
}

async function rasterizePdfToImageDataUrls(pdfBuffer, { maxPages = 8, pageNumbers = null, scale = 1.6 } = {}) {
  if (typeof globalThis.__parsePdfRasterizeHook === "function") {
    return await globalThis.__parsePdfRasterizeHook(pdfBuffer, { maxPages, pageNumbers, scale });
  }

  let pdfjs;
  let canvasMod;
  try {
    const dynamicImportRuntime = new Function("specifier", "return import(specifier)");
    pdfjs = await dynamicImportRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    canvasMod = await dynamicImportRuntime("@napi-rs/canvas");
  } catch (error) {
    throw new Error(
      "PDF image fallback unavailable. Install dependencies: pdfjs-dist and @napi-rs/canvas.",
      { cause: error },
    );
  }

  const { getDocument } = pdfjs;
  const { createCanvas } = canvasMod;
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const validPageNumbers = Array.isArray(pageNumbers)
    ? Array.from(
        new Set(
          pageNumbers
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= pdf.numPages),
        ),
      )
    : null;
  const pagesToRender = validPageNumbers || Array.from({ length: Math.min(pdf.numPages, maxPages) }, (_v, i) => i + 1);
  const imageUrls = [];

  for (const pageNumber of pagesToRender) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    const pngBuffer = canvas.toBuffer("image/png");
    imageUrls.push(`data:image/png;base64,${Buffer.from(pngBuffer).toString("base64")}`);
  }

  if (!imageUrls.length) {
    throw new Error("PDF image fallback failed: no pages were rendered to images.");
  }

  return imageUrls;
}

async function getPdfPageCount(pdfBuffer) {
  let pdfjs;
  try {
    const dynamicImportRuntime = new Function("specifier", "return import(specifier)");
    pdfjs = await dynamicImportRuntime("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    throw new Error("Unable to inspect PDF page count. Install pdfjs-dist dependency.", { cause: error });
  }
  const { getDocument } = pdfjs;
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  return Number(pdf.numPages || 0);
}

function buildChatPayload({ schema, systemPrompt, userPrompt, imagesOrPdfDataUrl, model }) {
  const content = [{ type: "text", text: userPrompt }];
  if (Array.isArray(imagesOrPdfDataUrl)) {
    imagesOrPdfDataUrl.forEach((url) => content.push({ type: "image_url", image_url: { url } }));
  } else if (imagesOrPdfDataUrl) {
    content.push({ type: "image_url", image_url: { url: imagesOrPdfDataUrl } });
  }

  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "enneagram_report_schema",
        strict: true,
        schema,
      },
    },
    max_tokens: 7000,
    temperature: 0.1,
  };
}

function chunkArray(input, size) {
  const out = [];
  for (let i = 0; i < input.length; i += size) {
    out.push(input.slice(i, i + size));
  }
  return out;
}

function toScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return Math.round(n);
}

function applyRegexMap(text, regex, assign) {
  let match;
  while ((match = regex.exec(text)) !== null) {
    assign(match);
  }
}

function extractScoresFromTextContent(reportContent) {
  const textChunks = [];
  (reportContent?.pages || []).forEach((page) => {
    if (page?.heading) textChunks.push(String(page.heading));
    if (page?.extractedText) textChunks.push(String(page.extractedText));
    if (Array.isArray(page?.keyDataPoints)) textChunks.push(page.keyDataPoints.join(" "));
  });
  (reportContent?.sections || []).forEach((section) => {
    if (section?.sectionTitle) textChunks.push(String(section.sectionTitle));
    if (section?.summary) textChunks.push(String(section.summary));
    if (section?.fullText) textChunks.push(String(section.fullText));
  });
  const text = textChunks.join("\n");

  const candidate = {
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
  };

  applyRegexMap(text, /\btype\s*([1-9])\s*[:=\-]?\s*(\d{1,3})\b/gi, (m) => {
    const key = `type${m[1]}`;
    candidate.typeScores[key] = toScore(m[2]);
  });

  applyRegexMap(text, /\bsx\b[^0-9]{0,12}(\d{1,3})\b/gi, (m) => {
    candidate.instinctScores.sexual = toScore(m[1]);
  });
  applyRegexMap(text, /\bso\b[^0-9]{0,12}(\d{1,3})\b/gi, (m) => {
    candidate.instinctScores.social = toScore(m[1]);
  });
  applyRegexMap(text, /\bsp\b[^0-9]{0,12}(\d{1,3})\b/gi, (m) => {
    candidate.instinctScores.selfPreservation = toScore(m[1]);
  });
  applyRegexMap(text, /\bself[\s-]?preservation\b[^0-9]{0,12}(\d{1,3})\b/gi, (m) => {
    candidate.instinctScores.selfPreservation = toScore(m[1]);
  });
  applyRegexMap(text, /\bsexual\b[^0-9]{0,12}(\d{1,3})\b/gi, (m) => {
    candidate.instinctScores.sexual = toScore(m[1]);
  });
  applyRegexMap(text, /\bsocial\b[^0-9]{0,12}(\d{1,3})\b/gi, (m) => {
    candidate.instinctScores.social = toScore(m[1]);
  });

  applyRegexMap(text, /\bhead\b[^0-9]{0,12}(\d{1,3})\b/gi, (m) => {
    candidate.centerScores.head = toScore(m[1]);
  });
  applyRegexMap(text, /\bheart\b[^0-9]{0,12}(\d{1,3})\b/gi, (m) => {
    candidate.centerScores.heart = toScore(m[1]);
  });
  applyRegexMap(text, /\bbody\b[^0-9]{0,12}(\d{1,3})\b/gi, (m) => {
    candidate.centerScores.body = toScore(m[1]);
  });

  return candidate;
}

function normalizeNarrativeLine(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function extractTypicalFeelingPatternLines(reportContent) {
  const sections = Array.isArray(reportContent?.sections) ? reportContent.sections : [];
  const pages = Array.isArray(reportContent?.pages) ? reportContent.pages : [];

  const sectionWithTypicalPatterns = sections.find((section) => {
    const haystack = `${section?.sectionTitle || ""} ${section?.summary || ""} ${section?.fullText || ""}`.toLowerCase();
    return haystack.includes("typical feeling patterns");
  });

  const orderedTextCandidates = [];
  if (sectionWithTypicalPatterns?.fullText) orderedTextCandidates.push(String(sectionWithTypicalPatterns.fullText));
  for (const page of pages) {
    const haystack = `${page?.heading || ""} ${page?.extractedText || ""}`.toLowerCase();
    if (haystack.includes("typical feeling patterns")) {
      orderedTextCandidates.push(`${page?.heading || ""} ${page?.extractedText || ""}`);
    }
  }
  for (const section of sections) {
    if (section?.fullText) orderedTextCandidates.push(String(section.fullText));
  }

  const text = orderedTextCandidates
    .filter(Boolean)
    .join("\n")
    .replace(/\r/g, " ");

  if (!text.trim()) return [];

  const blockMatch = text.match(
    /Typical\s+Feeling\s+Patterns\s*:?\s*([\s\S]{40,2600}?)(?=Blind\s+Spots\b|World\s*view\b|Worldview\b|Focus\s+of\s+Attention\b|Core\s+Fear\b|DEVELOPMENT\s+EXERCISE\b|$)/i,
  );
  const block = normalizeNarrativeLine(blockMatch?.[1] || "");
  if (!block) return [];

  const bulletChunks = block
    .replace(/\s*[•●◦▪]\s*/g, "\n")
    .split(/\n+/)
    .map((line) => normalizeNarrativeLine(line.replace(/^[-–—]\s*/, "")))
    .filter((line) => line.length >= 24 && !/^typical feeling patterns[:\s]*$/i.test(line));

  let lines = bulletChunks;
  if (!lines.length) {
    lines = (block.match(/[^.!?]+[.!?]/g) || [])
      .map((line) => normalizeNarrativeLine(line))
      .filter((line) => line.length >= 24);
  }

  return Array.from(new Set(lines)).slice(0, 4);
}

function deriveCorePatternFromReportContent(parsed) {
  const normalized = normalizeParsedShape(parsed);
  const primaryType = Number(normalized?.primaryType);
  const lines = extractTypicalFeelingPatternLines(normalized?.reportContent);
  if (!lines.length) {
    return {
      title: null,
      lines: [],
      source: null,
    };
  }
  return {
    title: Number.isInteger(primaryType) && primaryType >= 1 && primaryType <= 9
      ? `Type ${primaryType} Core Pattern`
      : "Type Core Pattern",
    lines,
    source: "reportContent.typicalFeelingPatterns",
  };
}

function fillNullScoresFromCandidate(parsed, candidate) {
  const merged = normalizeParsedShape(parsed);
  const out = normalizeParsedShape(merged);

  Object.keys(out.typeScores).forEach((key) => {
    if (out.typeScores[key] == null && candidate?.typeScores?.[key] != null) {
      out.typeScores[key] = candidate.typeScores[key];
    }
  });
  Object.keys(out.instinctScores).forEach((key) => {
    if (out.instinctScores[key] == null && candidate?.instinctScores?.[key] != null) {
      out.instinctScores[key] = candidate.instinctScores[key];
    }
  });
  Object.keys(out.centerScores).forEach((key) => {
    if (out.centerScores[key] == null && candidate?.centerScores?.[key] != null) {
      out.centerScores[key] = candidate.centerScores[key];
    }
  });
  return out;
}

function selectChartPageNumbers(reportContent) {
  const pages = Array.isArray(reportContent?.pages) ? reportContent.pages : [];
  const sections = Array.isArray(reportContent?.sections) ? reportContent.sections : [];
  const fromSections = [];
  sections.forEach((section) => {
    const hay = `${section?.sectionId || ""} ${section?.sectionTitle || ""} ${section?.summary || ""}`.toLowerCase();
    if (
      hay.includes("profile") ||
      hay.includes("type") ||
      hay.includes("instinct") ||
      hay.includes("center") ||
      hay.includes("score") ||
      hay.includes("subtype")
    ) {
      const start = Number(section?.pageStart);
      const end = Number(section?.pageEnd);
      if (Number.isInteger(start) && start > 0) fromSections.push(start);
      if (Number.isInteger(end) && end > 0) fromSections.push(end);
    }
  });

  const ranked = pages
    .map((page) => {
      const hay = `${page?.heading || ""} ${page?.extractedText || ""}`.toLowerCase();
      let score = 0;
      if (hay.includes("enneagram profile")) score += 4;
      if (hay.includes("all 9")) score += 3;
      if (hay.includes("type ")) score += 2;
      if (hay.includes("instinct")) score += 2;
      if (hay.includes("center")) score += 2;
      if (hay.includes("radar")) score += 2;
      if (hay.includes("chart")) score += 2;
      return { pageNumber: page?.pageNumber, score };
    })
    .filter((x) => Number.isInteger(x.pageNumber) && x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.pageNumber);

  const seed = Array.from(new Set([...(fromSections || []), ...(ranked || [])]))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 10);
  const expanded = Array.from(
    new Set(
      seed.flatMap((n) => [n - 1, n, n + 1]).filter((n) => Number.isInteger(n) && n > 0),
    ),
  ).slice(0, 20);
  if (expanded.length) return expanded;
  return [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
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
  const urlBuilders = [buildAzureResponsesApiUrl, buildAzureResponsesApiUrlLegacy];
  for (const version of candidateApiVersions(apiVersion)) {
    for (const buildUrl of urlBuilders) {
      try {
        const url = buildUrl(endpoint, version);
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
          const message = String(error?.message || "");
          if (!message.includes("Resource not found")) {
            throw error;
          }
        }
        console.log("[parsePdf] responses pass attempt failed, trying next candidate", {
          attemptedApiVersion: version,
          urlStyle: buildUrl === buildAzureResponsesApiUrl ? "v1" : "legacy",
          details: String(error?.message || error),
        });
      }
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

function getScoreCoverage(parsed) {
  const normalized = normalizeParsedShape(parsed);
  const typeValues = Object.values(normalized.typeScores || {});
  const instinctValues = Object.values(normalized.instinctScores || {});
  const centerValues = Object.values(normalized.centerScores || {});
  const nonNull = (arr) => arr.filter((v) => v != null).length;
  return {
    typeScoresNonNull: nonNull(typeValues),
    typeScoresTotal: typeValues.length,
    instinctScoresNonNull: nonNull(instinctValues),
    instinctScoresTotal: instinctValues.length,
    centerScoresNonNull: nonNull(centerValues),
    centerScoresTotal: centerValues.length,
  };
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
  return fillNullScoresFromCandidate(parsed, rescuedScores);
}

function normalizeScoreCandidate(raw) {
  const candidate = {
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
  };
  if (!raw || typeof raw !== "object") return candidate;

  Object.keys(candidate.typeScores).forEach((k) => {
    candidate.typeScores[k] = toScore(raw?.typeScores?.[k]);
  });
  Object.keys(candidate.instinctScores).forEach((k) => {
    candidate.instinctScores[k] = toScore(raw?.instinctScores?.[k]);
  });
  Object.keys(candidate.centerScores).forEach((k) => {
    candidate.centerScores[k] = toScore(raw?.centerScores?.[k]);
  });
  return candidate;
}

function consensusForValues(values, tolerance = 5) {
  const clean = values.filter((v) => v != null).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!clean.length) return null;
  if (clean.length === 1) return Math.round(clean[0]);

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (max - min <= tolerance) {
    return Math.round(clean.reduce((sum, n) => sum + n, 0) / clean.length);
  }

  // If there is disagreement, keep the median to reduce outlier impact.
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return Math.round(sorted[mid]);
}

function mergeScoreCandidatesWithConsensus(candidates, tolerance = 5) {
  const normalized = (Array.isArray(candidates) ? candidates : []).map(normalizeScoreCandidate);
  const out = normalizeScoreCandidate(null);

  Object.keys(out.typeScores).forEach((k) => {
    out.typeScores[k] = consensusForValues(normalized.map((c) => c?.typeScores?.[k]), tolerance);
  });
  Object.keys(out.instinctScores).forEach((k) => {
    out.instinctScores[k] = consensusForValues(normalized.map((c) => c?.instinctScores?.[k]), tolerance);
  });
  Object.keys(out.centerScores).forEach((k) => {
    out.centerScores[k] = consensusForValues(normalized.map((c) => c?.centerScores?.[k]), tolerance);
  });
  return out;
}

function buildReviewPackage(parsed, diagnostics) {
  const normalized = normalizeParsedShape(parsed);
  const fields = [];
  const pushField = (group, key, value, confidence = 0.6) => {
    fields.push({
      id: `${group}.${key}`,
      group,
      key,
      value: value == null ? null : Number(value),
      confidence: value == null ? 0 : confidence,
      needsReview: value == null,
    });
  };

  Object.entries(normalized.typeScores || {}).forEach(([key, value]) => pushField("typeScores", key, value));
  Object.entries(normalized.instinctScores || {}).forEach(([key, value]) => pushField("instinctScores", key, value));
  Object.entries(normalized.centerScores || {}).forEach(([key, value]) => pushField("centerScores", key, value));

  const pendingFields = fields.filter((f) => f.needsReview).map((f) => f.id);
  const status = pendingFields.length ? "needs_review" : "auto_approved";
  return {
    status,
    requiresHumanReview: pendingFields.length > 0,
    pendingFields,
    fieldConfidence: fields,
    summary: pendingFields.length
      ? `Missing ${pendingFields.length} numeric chart fields requiring manual confirmation`
      : "All numeric chart fields extracted with non-null values",
    parseVersion: diagnostics?.parserVersion || "multi-pass-v3",
    generatedAt: new Date().toISOString(),
  };
}

function isWeakExtractedContent(parsed) {
  const pages = Array.isArray(parsed?.reportContent?.pages) ? parsed.reportContent.pages : [];
  const sections = Array.isArray(parsed?.reportContent?.sections) ? parsed.reportContent.sections : [];
  if (pages.length < 10) return true;
  if (sections.length < 5) return true;

  const weakSectionText = sections.some((s) => {
    const full = String(s?.fullText || "").toLowerCase();
    return (
      full.includes("detailed description of the individual's enneagram type") ||
      full.includes("summary of this section")
    );
  });
  return weakSectionText;
}

async function runChatSchemaPass({
  endpoint,
  apiKey,
  apiVersion,
  deployment,
  schema,
  systemPrompt,
  userPrompt,
  imagesOrPdfDataUrl = null,
}) {
  const payload = buildChatPayload({
    schema,
    systemPrompt,
    userPrompt,
    imagesOrPdfDataUrl,
  });
  const legacyUrl = buildAzureDeploymentChatUrl(endpoint, deployment, apiVersion);
  try {
    const data = await callAzureWithRetry(legacyUrl, apiKey, payload);
    return safeJsonParse(parseChatCompletionsJson(data));
  } catch (legacyError) {
    const message = String(legacyError?.message || legacyError);
    if (!message.includes("Resource not found")) {
      console.log("[parsePdf] chat schema pass legacy endpoint failed, trying model endpoint", {
        details: message,
      });
    }
    const modelUrl = buildAzureResponsesUrl(endpoint, apiVersion);
    const data = await callAzureWithRetry(modelUrl, apiKey, { ...payload, model: deployment });
    return safeJsonParse(parseChatCompletionsJson(data));
  }
}

async function runPagesPassViaChatImages({ endpoint, apiKey, apiVersion, deployment, pdfBuffer }) {
  const maxPagesEnv = Number(process.env.PDF_PARSE_IMAGE_MAX_PAGES || 24);
  const pageCount = await getPdfPageCount(pdfBuffer);
  const targetPages = Math.min(Math.max(pageCount, 0), Math.max(maxPagesEnv, 1));
  if (!targetPages) {
    return { pages: [] };
  }

  const pageNumbers = Array.from({ length: targetPages }, (_v, i) => i + 1);
  const pageBatches = chunkArray(pageNumbers, 3);
  const outPages = [];

  for (const batch of pageBatches) {
    const imageDataUrls = await rasterizePdfToImageDataUrls(pdfBuffer, {
      maxPages: batch.length,
      pageNumbers: batch,
    });
    const userPrompt = [
      "These images are report pages in this exact order and page numbers:",
      batch.join(", "),
      "Return one page object per image, preserving pageNumber exactly from this list.",
      "Extract heading/title, major text, and key data points from each page.",
    ].join(" ");
    const data = await runChatSchemaPass({
      endpoint,
      apiKey,
      apiVersion,
      deployment,
      schema: PAGE_BATCH_SCHEMA,
      systemPrompt: PAGE_PASS_PROMPT,
      userPrompt,
      imagesOrPdfDataUrl: imageDataUrls,
    });
    if (Array.isArray(data?.pages)) {
      outPages.push(...data.pages);
    }
  }

  // Retry any missed pages one-by-one to avoid silent page drops.
  const seen = new Set(outPages.map((p) => Number(p?.pageNumber)).filter((n) => Number.isInteger(n) && n > 0));
  const missingPages = pageNumbers.filter((n) => !seen.has(n));
  for (const pageNumber of missingPages) {
    const imageDataUrls = await rasterizePdfToImageDataUrls(pdfBuffer, {
      maxPages: 1,
      pageNumbers: [pageNumber],
    });
    const data = await runChatSchemaPass({
      endpoint,
      apiKey,
      apiVersion,
      deployment,
      schema: PAGE_BATCH_SCHEMA,
      systemPrompt: PAGE_PASS_PROMPT,
      userPrompt: `Extract this single page. Its pageNumber is exactly ${pageNumber}. Return one page object with that pageNumber.`,
      imagesOrPdfDataUrl: imageDataUrls,
    }).catch(() => ({ pages: [] }));
    if (Array.isArray(data?.pages) && data.pages.length) {
      outPages.push(...data.pages);
    }
  }

  const deduped = Array.from(
    outPages.reduce((acc, page) => {
      const n = Number(page?.pageNumber || 0);
      if (!Number.isInteger(n) || n <= 0) return acc;
      if (!acc.has(n)) acc.set(n, page);
      return acc;
    }, new Map()).values(),
  );
  deduped.sort((a, b) => Number(a?.pageNumber || 0) - Number(b?.pageNumber || 0));
  return { pages: deduped };
}

async function runSectionsFromPagesViaChat({ endpoint, apiKey, apiVersion, deployment, pagesPayload }) {
  const pages = Array.isArray(pagesPayload?.pages) ? pagesPayload.pages : [];
  if (!pages.length) {
    return { sections: [], documentSummary: null };
  }
  const compactPagesText = pages
    .map((p) => {
      const heading = String(p?.heading || "");
      const excerpt = String(p?.extractedText || "").slice(0, 1800);
      const points = Array.isArray(p?.keyDataPoints) ? p.keyDataPoints.join("; ") : "";
      return `Page ${p?.pageNumber ?? "?"}\nHeading: ${heading}\nText: ${excerpt}\nPoints: ${points}`;
    })
    .join("\n\n");

  const userPrompt = [
    "Build section-by-section extraction using the following page content from the full report.",
    "Keep wording faithful to the source and avoid placeholders.",
    compactPagesText,
  ].join("\n");

  return runChatSchemaPass({
    endpoint,
    apiKey,
    apiVersion,
    deployment,
    schema: SECTIONS_SCHEMA,
    systemPrompt: SECTION_PASS_PROMPT,
    userPrompt,
  });
}

async function runScoreRescueViaChatImages({ endpoint, apiKey, apiVersion, deployment, pdfBuffer, reportContent }) {
  const pageNumbers = selectChartPageNumbers(reportContent);
  const scales = String(process.env.PDF_SCORE_RESCUE_SCALES || "1.8,2.4")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0.5 && n <= 4);
  const candidates = [];

  for (const scale of scales.length ? scales : [1.8]) {
    try {
      const imageDataUrls = await rasterizePdfToImageDataUrls(pdfBuffer, {
        maxPages: 20,
        pageNumbers,
        scale,
      });
      const pass = await runChatSchemaPass({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        schema: SCORE_RESCUE_SCHEMA,
        systemPrompt: SCORE_RESCUE_PROMPT,
        userPrompt: `Read these chart pages and return numeric scores only. Render scale used: ${scale}.`,
        imagesOrPdfDataUrl: imageDataUrls,
      });
      candidates.push(pass);
    } catch (error) {
      console.log("[parsePdf] score rescue attempt failed for scale", {
        scale,
        details: String(error?.message || error),
      });
    }
  }

  if (!candidates.length) {
    throw new Error("Image score rescue failed for all scale attempts.");
  }

  return mergeScoreCandidatesWithConsensus(candidates, 5);
}

async function parseViaChatCompletions({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl, pdfBuffer }) {
  const userPrompt = "Extract all data from this iEQ9 report into the requested schema.";
  const payload = buildChatPayload({
    schema: CORE_SCHEMA,
    systemPrompt: CORE_SYSTEM_PROMPT,
    userPrompt,
    imagesOrPdfDataUrl: pdfDataUrl,
  });
  const legacyUrl = buildAzureDeploymentChatUrl(endpoint, deployment, apiVersion);
  try {
    const data = await callAzureWithRetry(legacyUrl, apiKey, payload);
    return normalizeParsedShape(parseChatCompletionsJson(data));
  } catch (legacyError) {
    if (isPdfMimeUnsupportedForImageUrlError(legacyError)) {
      console.log("[parsePdf] legacy chat endpoint rejected application/pdf image_url. Attempting PDF->image fallback.");
      const imageDataUrls = await rasterizePdfToImageDataUrls(pdfBuffer);
      const imagePayload = buildChatPayload({
        schema: CORE_SCHEMA,
        systemPrompt: CORE_SYSTEM_PROMPT,
        userPrompt,
        imagesOrPdfDataUrl: imageDataUrls,
        model: deployment,
      });
      const data = await callAzureWithRetry(legacyUrl, apiKey, imagePayload);
      return normalizeParsedShape(parseChatCompletionsJson(data));
    }

    console.log("[parsePdf] legacy deployment chat endpoint failed, trying model-based chat endpoint", {
      details: String(legacyError?.message || legacyError),
    });
    const modelUrl = buildAzureResponsesUrl(endpoint, apiVersion);
    try {
      const data = await callAzureWithRetry(modelUrl, apiKey, { ...payload, model: deployment });
      return normalizeParsedShape(parseChatCompletionsJson(data));
    } catch (modelError) {
      if (!isPdfMimeUnsupportedForImageUrlError(modelError)) {
        throw modelError;
      }

      console.log("[parsePdf] chat endpoint rejected application/pdf image_url. Attempting PDF->image fallback.");
      const imageDataUrls = await rasterizePdfToImageDataUrls(pdfBuffer);
      const imagePayload = buildChatPayload({
        schema: CORE_SCHEMA,
        systemPrompt: CORE_SYSTEM_PROMPT,
        userPrompt,
        imagesOrPdfDataUrl: imageDataUrls,
        model: deployment,
      });
      const data = await callAzureWithRetry(modelUrl, apiKey, imagePayload);
      return normalizeParsedShape(parseChatCompletionsJson(data));
    }
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
  const parserVersion = "multi-pass-v3";
  const diagnostics = {
    parserVersion,
    requestedApiVersion: apiVersion,
    deployment,
    startedAt: new Date().toISOString(),
    steps: [],
    warnings: [],
    errors: [],
    extraction: {
      mode: "image-primary",
      pages: 0,
      sections: 0,
      minExpectedPages: Number(process.env.PDF_PARSE_MIN_PAGES || 20),
    },
    scoreCoverage: null,
    isComplete: false,
    incompleteReason: null,
  };
  const pushStep = (step, details = null) => diagnostics.steps.push({ step, at: new Date().toISOString(), details });
  const pushWarning = (message, details = null) =>
    diagnostics.warnings.push({ message, at: new Date().toISOString(), details });
  const pushError = (message, details = null) =>
    diagnostics.errors.push({ message, at: new Date().toISOString(), details });

  let parsed = null;
  try {
    parsed = await runCorePass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl });
    console.log("[parsePdf] Core pass succeeded");
    pushStep("core_pass_succeeded");

    // Primary strategy: image-based page extraction for robust chart/text parsing.
    let pagesPayload = { pages: [] };
    let sectionsPayload = { sections: [], documentSummary: null };
    try {
      pagesPayload = await runPagesPassViaChatImages({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        pdfBuffer,
      });
      pushStep("image_pages_pass_succeeded", { pages: Array.isArray(pagesPayload?.pages) ? pagesPayload.pages.length : 0 });
      sectionsPayload = await runSectionsFromPagesViaChat({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        pagesPayload,
      });
      pushStep("image_sections_pass_succeeded", {
        sections: Array.isArray(sectionsPayload?.sections) ? sectionsPayload.sections.length : 0,
      });
    } catch (imagePrimaryError) {
      pushWarning("image_primary_content_extraction_failed", String(imagePrimaryError?.message || imagePrimaryError));
      console.log("[parsePdf] image-primary content extraction failed, falling back to responses passes", {
        details: String(imagePrimaryError?.message || imagePrimaryError),
      });
      const [respPages, respSections] = await Promise.all([
        runPagesPass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }).catch((error) => {
          pushWarning("responses_page_pass_failed", String(error?.message || error));
          console.log("[parsePdf] Page pass failed", { details: String(error?.message || error) });
          return { pages: [] };
        }),
        runSectionsPass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }).catch((error) => {
          pushWarning("responses_section_pass_failed", String(error?.message || error));
          console.log("[parsePdf] Section pass failed", { details: String(error?.message || error) });
          return { sections: [], documentSummary: null };
        }),
      ]);
      pagesPayload = respPages;
      sectionsPayload = respSections;
      pushStep("responses_content_fallback_applied", {
        pages: Array.isArray(pagesPayload?.pages) ? pagesPayload.pages.length : 0,
        sections: Array.isArray(sectionsPayload?.sections) ? sectionsPayload.sections.length : 0,
      });
    }

    parsed = mergeReportContent(parsed, pagesPayload, sectionsPayload);
    parsed = fillNullScoresFromCandidate(parsed, extractScoresFromTextContent(parsed.reportContent));
    pushStep("content_merged");
  } catch (responsesError) {
    console.log("[parsePdf] responses passes failed, falling back to chat_completions", {
      details: String(responsesError?.message || responsesError),
    });
    pushWarning("core_responses_failed_fallback_chat", String(responsesError?.message || responsesError));
    parsed = await parseViaChatCompletions({
      endpoint,
      apiKey,
      apiVersion,
      deployment,
      pdfDataUrl,
      pdfBuffer,
    });
    pushStep("chat_core_fallback_succeeded");
  }

  if (isWeakExtractedContent(parsed)) {
    try {
      console.log("[parsePdf] Running image-based full-content extraction after fallback path.");
      const imagePagesPayload = await runPagesPassViaChatImages({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        pdfBuffer,
      });
      const imageSectionsPayload = await runSectionsFromPagesViaChat({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        pagesPayload: imagePagesPayload,
      });
      parsed = mergeReportContent(parsed, imagePagesPayload, imageSectionsPayload);
      parsed = fillNullScoresFromCandidate(parsed, extractScoresFromTextContent(parsed.reportContent));
      pushStep("post_fallback_image_content_applied", {
        pages: Array.isArray(parsed?.reportContent?.pages) ? parsed.reportContent.pages.length : 0,
        sections: Array.isArray(parsed?.reportContent?.sections) ? parsed.reportContent.sections.length : 0,
      });
    } catch (fallbackContentError) {
      console.log("[parsePdf] image-based full-content extraction failed", {
        details: String(fallbackContentError?.message || fallbackContentError),
      });
      pushWarning("post_fallback_image_content_failed", String(fallbackContentError?.message || fallbackContentError));
    }
  }

  // Chart numerics: image-only rescue on chart-centric pages.
  if (needsScoreRescue(parsed)) {
    try {
      const imageRescued = await runScoreRescueViaChatImages({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        pdfBuffer,
        reportContent: parsed.reportContent,
      });
      parsed = mergeWithRescuedScores(parsed, imageRescued);
      console.log("[parsePdf] Applied image-based score rescue pass");
      pushStep("image_score_rescue_applied");
    } catch (imageRescueError) {
      console.log("[parsePdf] Image-based score rescue pass failed", {
        details: String(imageRescueError?.message || imageRescueError),
      });
      pushWarning("image_score_rescue_failed", String(imageRescueError?.message || imageRescueError));
    }
  }

  const normalized = normalizeParsedShape(parsed);
  normalized.corePattern = deriveCorePatternFromReportContent(normalized);
  const extractedPages = Array.isArray(normalized?.reportContent?.pages) ? normalized.reportContent.pages.length : 0;
  const extractedSections = Array.isArray(normalized?.reportContent?.sections)
    ? normalized.reportContent.sections.length
    : 0;
  diagnostics.extraction.pages = extractedPages;
  diagnostics.extraction.sections = extractedSections;
  diagnostics.scoreCoverage = getScoreCoverage(normalized);
  const hasMinimumPages = extractedPages >= diagnostics.extraction.minExpectedPages;
  const hasFullChartScores =
    diagnostics.scoreCoverage.typeScoresNonNull >= diagnostics.scoreCoverage.typeScoresTotal &&
    diagnostics.scoreCoverage.instinctScoresNonNull >= diagnostics.scoreCoverage.instinctScoresTotal &&
    diagnostics.scoreCoverage.centerScoresNonNull >= diagnostics.scoreCoverage.centerScoresTotal;
  if (!hasMinimumPages) {
    diagnostics.isComplete = false;
    diagnostics.incompleteReason = `Extracted ${extractedPages} pages, expected at least ${diagnostics.extraction.minExpectedPages}`;
    pushError("parse_incomplete_low_page_coverage", diagnostics.incompleteReason);
  } else if (!hasFullChartScores) {
    diagnostics.isComplete = false;
    diagnostics.incompleteReason =
      "Chart numerics incomplete: one or more type, instinct, or center scores are null";
    pushError("parse_incomplete_missing_chart_scores", diagnostics.incompleteReason);
  } else {
    diagnostics.isComplete = true;
  }
  diagnostics.completedAt = new Date().toISOString();
  const review = buildReviewPackage(normalized, diagnostics);

  return {
    ...normalized,
    _parseDiagnostics: diagnostics,
    _parseStatus: diagnostics.isComplete ? "complete" : "incomplete",
    _review: review,
  };
}
