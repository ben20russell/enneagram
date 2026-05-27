import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

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
- extractedText (full visible text from that page, preserving wording; do not summarize)
- keyDataPoints (explicit values, labels, and high-signal statements on that page)
Return strict JSON.`;

const SECTION_PASS_PROMPT = `Perform a section-by-section extraction for the entire iEQ9 report.
Group content into meaningful report sections (core type, subtype/instincts, centers, wings, integration, leadership, communication, strain, development).
For each section return section id/title, page range, summary, and full text block.
Return strict JSON.`;

const SCORE_RESCUE_PROMPT = `You are an expert data extraction assistant for Integrative Enneagram (iEQ9) reports.
Extract values only from visual charts and graphics. Do not infer from narrative prose.

Targets:
- Type Scores: spider/radar chart and Enneagram Type 1-9 bar graphs. Extract exact values for type1..type9.
- Centers of Expression: Head, Heart, Body values from charts (numeric if shown; if only qualitative labels appear, map High=80, Medium/Moderate=55, Low=25).
- Instincts: 27 Subtypes & Instincts visuals. Extract Self-Preservation, Sexual (1-on-1), Social as exact scores.

Quality rules:
- Prefer explicit numeric labels visible in charts.
- If a value is unreadable/absent, return null.
- Return ONLY strict JSON matching the schema.`;

const BASE_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const MAX_RETRIES = 5;

function toUint8Array(input) {
  if (typeof input === "string") return new Uint8Array(readFileSync(resolve(input)));
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (input instanceof Uint8Array) return input;
  throw new TypeError(`unexpected input type: ${typeof input}`);
}

function normalizePdfJsModule(mod) {
  if (mod && typeof mod.getDocument === "function") {
    return mod;
  }
  if (mod?.default && typeof mod.default.getDocument === "function") {
    return mod.default;
  }
  return mod;
}

function configurePdfJsForNode(pdfjsLib) {
  if (!pdfjsLib || typeof pdfjsLib !== "object") return;
  try {
    if (pdfjsLib?.GlobalWorkerOptions && typeof pdfjsLib.GlobalWorkerOptions === "object") {
      // Force a dummy worker config so pdfjs never tries to resolve pdf.worker.mjs from disk.
      pdfjsLib.GlobalWorkerOptions.workerPort = null;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "data:text/javascript,";
    }
  } catch (error) {
    console.log("[parsePdf] pdfjs worker configuration failed", {
      details: String(error?.message || error),
    });
  }
}

async function importPdfJsLegacyBuild() {
  const dynamicImportRuntime = new Function("specifier", "return import(specifier)");
  // Prefer hard-disk absolute paths to avoid bundler-virtual URLs at runtime.
  const cwd = process.cwd();
  const diskCandidates = [
    join(cwd, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs"),
    join(cwd, "node_modules", "pdfjs-dist", "build", "pdf.mjs"),
    join(cwd, "..", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs"),
    join(cwd, "..", "node_modules", "pdfjs-dist", "build", "pdf.mjs"),
  ]
    .filter((absPath) => existsSync(absPath))
    .map((absPath) => pathToFileURL(absPath).href);

  // Keep package specifier fallbacks for environments where node_modules resolution is standard.
  const specifiers = [
    ...diskCandidates,
    "pdfjs-dist/legacy/build/pdf.mjs",
    "pdfjs-dist/build/pdf.mjs",
    "pdfjs-dist/legacy/build/pdf.js",
  ];
  let lastError = null;
  for (const specifier of specifiers) {
    try {
      console.log("[parsePdf] Attempting pdfjs-dist import", { specifier });
      const pdfjsLib = normalizePdfJsModule(await dynamicImportRuntime(specifier));
      configurePdfJsForNode(pdfjsLib);
      return pdfjsLib;
    } catch (error) {
      lastError = error;
      console.log("[parsePdf] pdfjs-dist import failed", {
        specifier,
        details: String(error?.message || error),
      });
    }
  }
  throw lastError || new Error("Unable to load pdfjs-dist legacy build.");
}

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

function parseRetryAfterMs(headerValue) {
  const raw = String(headerValue || "").trim();
  if (!raw) return null;

  const numericSeconds = Number(raw);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.min(20_000, Math.round(numericSeconds * 1000));
  }

  const retryAtEpochMs = Date.parse(raw);
  if (!Number.isFinite(retryAtEpochMs)) return null;
  const deltaMs = retryAtEpochMs - Date.now();
  if (deltaMs <= 0) return null;
  return Math.min(20_000, Math.round(deltaMs));
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

async function maybeDelayBetweenAzurePasses() {
  const spacingRaw = Number(process.env.PDF_PARSE_PASS_SPACING_MS || 200);
  if (!Number.isFinite(spacingRaw) || spacingRaw <= 0) return;
  await sleep(Math.floor(spacingRaw));
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
        const retryAfterMs = parseRetryAfterMs(response?.headers?.get("retry-after"));
        if (retryAfterMs != null) {
          error.retryAfterMs = retryAfterMs;
        }
        throw error;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES || !isTransientError(error)) {
        throw error;
      }
      const baseDelay = BASE_DELAYS_MS[Math.min(attempt - 1, BASE_DELAYS_MS.length - 1)];
      const retryAfterMs = Number(error?.retryAfterMs);
      const normalizedRetryAfterMs =
        Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(20_000, Math.round(retryAfterMs)) : null;
      const effectiveBaseDelay = normalizedRetryAfterMs != null ? Math.max(baseDelay, normalizedRetryAfterMs) : baseDelay;
      const delay = jitterDelayMs(effectiveBaseDelay);
      console.log(
        `[parsePdf retry] attempt=${attempt}/${MAX_RETRIES} delayMs=${delay} retryAfterMs=${
          normalizedRetryAfterMs ?? "n/a"
        } errorClass=${error?.status || error?.name || "UnknownError"}`,
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

function buildAzureModelChatUrlV1(endpoint) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/v1/chat/completions`;
}

function buildAzureResponsesApiUrlV1(endpoint) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/v1/responses`;
}

function buildAzureResponsesApiUrl(endpoint, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/v1/responses?api-version=${encodeURIComponent(apiVersion)}`;
}

function buildAzureResponsesApiUrlLegacy(endpoint, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/responses?api-version=${encodeURIComponent(apiVersion)}`;
}

function buildAzureDeploymentResponsesApiUrl(endpoint, deployment, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/deployments/${encodeURIComponent(deployment)}/responses?api-version=${encodeURIComponent(apiVersion)}`;
}

function buildAzureDeploymentChatUrl(endpoint, deployment, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  return `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

function candidateApiVersions(preferredApiVersion) {
  const apiVersionsToTry = [
    String(preferredApiVersion || "").trim(), // Primary version from env config
    "2024-11-20", // Standard stable release fallback
  ].filter(Boolean);

  return Array.from(new Set(apiVersionsToTry));
}

function isUnsupportedApiVersionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("api version not supported") ||
    message.includes("enabled only for api-version")
  );
}

async function callAzureModelChatWithEndpointFallback({ endpoint, apiKey, apiVersion, deployment, payload }) {
  const endpointCandidates = [
    { urlStyle: "v1", url: buildAzureModelChatUrlV1(endpoint) },
    { urlStyle: "legacy-model", url: buildAzureResponsesUrl(endpoint, apiVersion) },
  ];

  let lastError = null;
  for (const candidate of endpointCandidates) {
    try {
      return await callAzureWithRetry(candidate.url, apiKey, { ...payload, model: deployment });
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      if (!isUnsupportedApiVersionError(error) && !message.includes("Resource not found")) {
        throw error;
      }
      console.log("[parsePdf] model chat endpoint attempt failed, trying next candidate", {
        urlStyle: candidate.urlStyle,
        details: message,
      });
    }
  }

  throw lastError || new Error("Azure OpenAI parse failed: no supported model chat endpoint found");
}

function isPdfMimeUnsupportedForImageUrlError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("invalid image url") &&
    message.includes("unsupported mime type") &&
    message.includes("application/pdf")
  );
}

function isLikelyTruncatedJsonParseError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("unterminated string") ||
    message.includes("unexpected end of json input") ||
    message.includes("unexpected end of input") ||
    message.includes("end of data while reading")
  );
}

function buildTokenExpansionCandidates(baseTokens, cap = 24_000) {
  const normalizedBase = Number(baseTokens);
  const safeBase = Number.isFinite(normalizedBase) && normalizedBase > 256 ? Math.floor(normalizedBase) : 4096;
  const normalizedCap = Number.isFinite(Number(cap)) && Number(cap) > safeBase ? Math.floor(Number(cap)) : 24_000;
  const expanded = Math.min(normalizedCap, Math.max(safeBase + 2048, Math.round(safeBase * 1.6)));
  return Array.from(new Set([safeBase, expanded]));
}

async function rasterizePdfToImageDataUrls(pdfBuffer, { maxPages = 8, pageNumbers = null, scale = 1.6 } = {}) {
  if (typeof globalThis.__parsePdfRasterizeHook === "function") {
    return await globalThis.__parsePdfRasterizeHook(pdfBuffer, { maxPages, pageNumbers, scale });
  }

  let pdfjs;
  let canvasMod;
  try {
    const dynamicImportRuntime = new Function("specifier", "return import(specifier)");
    pdfjs = await importPdfJsLegacyBuild();
    canvasMod = await dynamicImportRuntime("@napi-rs/canvas");
  } catch (error) {
    throw new Error(
      "PDF image fallback unavailable. Install dependencies: pdfjs-dist and @napi-rs/canvas.",
      { cause: error },
    );
  }

  configurePdfJsForNode(pdfjs);
  const { getDocument } = pdfjs;
  const { createCanvas } = canvasMod;
  const maxPixelsRaw = Number(process.env.PDF_PARSE_RASTER_MAX_PIXELS || 4_200_000);
  const maxPixels = Number.isFinite(maxPixelsRaw) && maxPixelsRaw > 100_000 ? Math.floor(maxPixelsRaw) : 4_200_000;
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });
  let pdf = null;
  try {
    pdf = await loadingTask.promise;
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
      let canvas = null;
      try {
        let effectiveScale = Number(scale);
        if (!Number.isFinite(effectiveScale) || effectiveScale <= 0.25) {
          effectiveScale = 1.6;
        }
        let viewport = page.getViewport({ scale: effectiveScale });
        const totalPixels = Math.ceil(viewport.width) * Math.ceil(viewport.height);
        if (maxPixels > 0 && totalPixels > maxPixels) {
          const adjustment = Math.sqrt(maxPixels / totalPixels);
          effectiveScale = Math.max(0.7, Number((effectiveScale * adjustment).toFixed(3)));
          viewport = page.getViewport({ scale: effectiveScale });
          console.log("[parsePdf] rasterize scale adjusted to stay within memory target", {
            pageNumber,
            requestedScale: scale,
            effectiveScale,
            maxPixels,
          });
        }

        canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        await page.render({ canvasContext: context, viewport }).promise;
        const pngBuffer = canvas.toBuffer("image/png");
        imageUrls.push(`data:image/png;base64,${Buffer.from(pngBuffer).toString("base64")}`);
      } finally {
        try {
          page.cleanup?.();
        } catch (cleanupError) {
          console.log("[parsePdf] page cleanup failed", {
            pageNumber,
            details: String(cleanupError?.message || cleanupError),
          });
        }
        if (canvas) {
          try {
            canvas.width = 1;
            canvas.height = 1;
          } catch (canvasCleanupError) {
            console.log("[parsePdf] canvas cleanup failed", {
              pageNumber,
              details: String(canvasCleanupError?.message || canvasCleanupError),
            });
          }
        }
      }
    }

    if (!imageUrls.length) {
      throw new Error("PDF image fallback failed: no pages were rendered to images.");
    }

    return imageUrls;
  } finally {
    try {
      await loadingTask.destroy?.();
    } catch (destroyError) {
      console.log("[parsePdf] loadingTask destroy failed", {
        details: String(destroyError?.message || destroyError),
      });
    }
    try {
      await pdf?.cleanup?.();
    } catch (pdfCleanupError) {
      console.log("[parsePdf] PDF cleanup failed", {
        details: String(pdfCleanupError?.message || pdfCleanupError),
      });
    }
    try {
      await pdf?.destroy?.();
    } catch (pdfDestroyError) {
      console.log("[parsePdf] PDF destroy failed", {
        details: String(pdfDestroyError?.message || pdfDestroyError),
      });
    }
  }
}

async function getPdfPageCount(pdfBuffer) {
  if (typeof globalThis.__parsePdfPageCountHook === "function") {
    const hookedCount = await globalThis.__parsePdfPageCountHook(pdfBuffer);
    const normalizedHookedCount = Math.max(0, Math.floor(Number(hookedCount || 0)));
    console.log(`[parsePdf] Document loaded successfully. Total pages: ${normalizedHookedCount}`);
    return normalizedHookedCount;
  }

  let pdfjsLib;
  try {
    pdfjsLib = await importPdfJsLegacyBuild();
  } catch (error) {
    throw new Error("Unable to inspect PDF page count. Install pdfjs-dist dependency.", { cause: error });
  }
  configurePdfJsForNode(pdfjsLib);
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const totalPages = Number(pdf.numPages || 0);
  console.log(`[parsePdf] Document loaded successfully. Total pages: ${totalPages}`);
  return totalPages;
}

function normalizePdfLayerText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildTextLinesFromPdfJsItems(items) {
  const buckets = new Map();
  const bucketSize = 2;

  (Array.isArray(items) ? items : []).forEach((item) => {
    const raw = String(item?.str || "").replace(/\s+/g, " ").trim();
    if (!raw) return;
    const transform = Array.isArray(item?.transform) ? item.transform : [];
    const x = Number(transform?.[4] || 0);
    const y = Number(transform?.[5] || 0);
    const bucketKey = Math.round(y / bucketSize) * bucketSize;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey).push({ x, text: raw });
  });

  return Array.from(buckets.entries())
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map((entry) => entry?.[1] || [])
    .map((parts) =>
      parts
        .sort((a, b) => Number(a.x || 0) - Number(b.x || 0))
        .map((part) => part.text)
        .join(" "),
    )
    .map((line) => normalizePdfLayerText(line))
    .filter(Boolean);
}

function inferPageHeading(lines) {
  const heading = (Array.isArray(lines) ? lines : []).find((line) => {
    const trimmed = normalizePdfLayerText(line);
    if (!trimmed) return false;
    if (trimmed.length < 3 || trimmed.length > 120) return false;
    return /[A-Za-z]/.test(trimmed);
  });
  return heading || null;
}

function inferKeyDataPoints(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => normalizePdfLayerText(line))
    .filter((line) => line.length >= 4 && line.length <= 220)
    .filter((line) => /\d/.test(line) || /(type|instinct|center|wing|level|fear|desire|pattern|summary)/i.test(line))
    .slice(0, 14);
}

async function extractPagesTextFromPdfLayer(pdfBuffer) {
  if (typeof globalThis.__parsePdfExtractTextHook === "function") {
    const hooked = await globalThis.__parsePdfExtractTextHook(pdfBuffer);
    if (Array.isArray(hooked)) {
      return { pages: hooked };
    }
    if (hooked && typeof hooked === "object" && Array.isArray(hooked.pages)) {
      return { pages: hooked.pages };
    }
    return { pages: [] };
  }

  let pdfjs;
  try {
    pdfjs = await importPdfJsLegacyBuild();
  } catch (error) {
    throw new Error("Unable to extract deterministic PDF text. Install pdfjs-dist dependency.", { cause: error });
  }
  configurePdfJsForNode(pdfjs);
  const { getDocument } = pdfjs;

  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= Number(pdf.numPages || 0); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = buildTextLinesFromPdfJsItems(textContent?.items || []);
    const extractedText = normalizePdfLayerText(lines.join("\n"));
    pages.push({
      pageNumber,
      heading: inferPageHeading(lines),
      extractedText: extractedText || null,
      keyDataPoints: inferKeyDataPoints(lines),
    });
  }

  return { pages };
}

function normalizePageForMerge(raw) {
  const pageNumber = Number(raw?.pageNumber || 0);
  if (!Number.isInteger(pageNumber) || pageNumber <= 0) return null;
  return {
    pageNumber,
    heading: raw?.heading == null ? null : String(raw.heading),
    extractedText: raw?.extractedText == null ? null : String(raw.extractedText),
    keyDataPoints: Array.isArray(raw?.keyDataPoints)
      ? raw.keyDataPoints.filter((v) => typeof v === "string")
      : [],
  };
}

function pickPreferredPageText(layerText, modelText) {
  const normalizedLayer = normalizePdfLayerText(layerText);
  const normalizedModel = normalizePdfLayerText(modelText);
  if (!normalizedLayer) return normalizedModel || null;
  if (!normalizedModel) return normalizedLayer;
  if (
    normalizedLayer.length >= normalizedModel.length ||
    normalizedLayer.length >= 120 ||
    normalizedLayer.length >= Math.round(normalizedModel.length * 0.6)
  ) {
    return normalizedLayer;
  }
  return normalizedModel;
}

function mergePagesWithPdfTextLayer(pagesPayload, layerPagesPayload) {
  const modelPages = Array.isArray(pagesPayload?.pages) ? pagesPayload.pages : [];
  const layerPages = Array.isArray(layerPagesPayload?.pages) ? layerPagesPayload.pages : [];
  if (!layerPages.length) {
    return { pages: modelPages };
  }

  const modelMap = new Map();
  modelPages.forEach((page) => {
    const normalized = normalizePageForMerge(page);
    if (normalized) modelMap.set(normalized.pageNumber, normalized);
  });

  const layerMap = new Map();
  layerPages.forEach((page) => {
    const normalized = normalizePageForMerge(page);
    if (normalized) layerMap.set(normalized.pageNumber, normalized);
  });

  const pageNumbers = Array.from(new Set([...modelMap.keys(), ...layerMap.keys()])).sort((a, b) => a - b);
  const mergedPages = pageNumbers.map((pageNumber) => {
    const model = modelMap.get(pageNumber) || null;
    const layer = layerMap.get(pageNumber) || null;
    const mergedKeyDataPoints = Array.from(
      new Set([...(layer?.keyDataPoints || []), ...(model?.keyDataPoints || [])].filter(Boolean)),
    );
    return {
      pageNumber,
      heading: layer?.heading || model?.heading || null,
      extractedText: pickPreferredPageText(layer?.extractedText, model?.extractedText),
      keyDataPoints: mergedKeyDataPoints,
    };
  });

  return { pages: mergedPages };
}

function buildChatPayload({
  schema = null,
  systemPrompt,
  userPrompt,
  imagesOrPdfDataUrl,
  model,
  responseFormatType = "json_schema",
  maxTokens = 7000,
}) {
  const content = [{ type: "text", text: userPrompt }];
  if (Array.isArray(imagesOrPdfDataUrl)) {
    imagesOrPdfDataUrl.forEach((url) => content.push({ type: "image_url", image_url: { url } }));
  } else if (imagesOrPdfDataUrl) {
    content.push({ type: "image_url", image_url: { url: imagesOrPdfDataUrl } });
  }

  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    max_tokens: maxTokens,
    temperature: 0.1,
  };

  if (responseFormatType === "json_object") {
    payload.response_format = { type: "json_object" };
    return payload;
  }

  if (!schema || typeof schema !== "object") {
    throw new Error("Chat payload schema is required when responseFormatType is json_schema.");
  }

  payload.response_format = {
    type: "json_schema",
    json_schema: {
      name: "enneagram_report_schema",
      strict: true,
      schema,
    },
  };
  return payload;
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

function levelToScore(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "HIGH") return 80;
  if (normalized === "MEDIUM" || normalized === "MODERATE") return 55;
  if (normalized === "LOW") return 25;
  return null;
}

function toCenterScore(value) {
  const numeric = toScore(value);
  if (numeric != null) return numeric;
  return levelToScore(value);
}

function mapCenterLabelToKey(label) {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized === "head" || normalized === "thinking") return "head";
  if (normalized === "heart" || normalized === "feeling") return "heart";
  if (normalized === "body" || normalized === "action") return "body";
  return null;
}

function mapInstinctLabelToKey(label) {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized === "sp" || normalized === "self-preservation" || normalized === "self preservation") {
    return "selfPreservation";
  }
  if (
    normalized === "sx" ||
    normalized === "sexual" ||
    normalized === "one-on-one" ||
    normalized === "one on one" ||
    normalized === "1-on-1" ||
    normalized === "1 on 1"
  ) {
    return "sexual";
  }
  if (normalized === "so" || normalized === "social") {
    return "social";
  }
  return null;
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

  applyRegexMap(text, /\b(head|heart|body)\b[^A-Za-z0-9]{0,24}\b(high|medium|moderate|low)\b/gi, (m) => {
    const key = mapCenterLabelToKey(m[1]);
    if (!key) return;
    candidate.centerScores[key] = toCenterScore(m[2]);
  });
  applyRegexMap(
    text,
    /\b(action|feeling|thinking)\s+center(?:\s+of\s+expression)?\b[^A-Za-z0-9]{0,32}\b(high|medium|moderate|low)\b/gi,
    (m) => {
      const key = mapCenterLabelToKey(m[1]);
      if (!key) return;
      candidate.centerScores[key] = toCenterScore(m[2]);
    },
  );
  applyRegexMap(
    text,
    /\b(sp|sx|so|self[\s-]?preservation|sexual|social|1[\s-]?on[\s-]?1|one[\s-]?on[\s-]?one)\b[^A-Za-z0-9]{0,24}\b(high|medium|moderate|low)\b/gi,
    (m) => {
      const key = mapInstinctLabelToKey(m[1]);
      if (!key) return;
      candidate.instinctScores[key] = levelToScore(m[2]);
    },
  );

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
  const tokenCap = Number(process.env.PDF_PARSE_MAX_OUTPUT_TOKENS_CAP || 24000);
  const tokenBudgets = buildTokenExpansionCandidates(maxOutputTokens, tokenCap);
  const endpointCandidates = [
    {
      urlStyle: "v1",
      versions: [null],
      buildUrl: () => buildAzureResponsesApiUrlV1(endpoint),
    },
    {
      urlStyle: "deployment",
      versions: candidateApiVersions(apiVersion),
      buildUrl: (version) => buildAzureDeploymentResponsesApiUrl(endpoint, deployment, version),
    },
    {
      urlStyle: "legacy",
      versions: candidateApiVersions(apiVersion),
      buildUrl: (version) => buildAzureResponsesApiUrlLegacy(endpoint, version),
    },
    {
      urlStyle: "v1-with-version",
      versions: candidateApiVersions(apiVersion),
      buildUrl: (version) => buildAzureResponsesApiUrl(endpoint, version),
    },
  ];

  for (const endpointCandidate of endpointCandidates) {
    for (const version of endpointCandidate.versions) {
      const attemptedApiVersion = version || "none";
      for (let tokenIdx = 0; tokenIdx < tokenBudgets.length; tokenIdx += 1) {
        const tokenBudget = tokenBudgets[tokenIdx];
        try {
          const url = endpointCandidate.buildUrl(version);
          const payload = buildResponsesPayload({
            model: deployment,
            systemPrompt,
            userPrompt,
            schema,
            pdfDataUrl,
            maxOutputTokens: tokenBudget,
          });
          const data = await callAzureWithRetry(url, apiKey, payload);
          try {
            return parseResponsesJson(data);
          } catch (parseError) {
            lastError = parseError;
            const canRetryWithBiggerBudget =
              tokenIdx < tokenBudgets.length - 1 && isLikelyTruncatedJsonParseError(parseError);
            if (canRetryWithBiggerBudget) {
              console.log("[parsePdf] responses parse output appears truncated; retrying with larger token budget", {
                attemptedApiVersion,
                urlStyle: endpointCandidate.urlStyle,
                tokenBudget,
                nextTokenBudget: tokenBudgets[tokenIdx + 1],
                details: String(parseError?.message || parseError),
              });
              continue;
            }
            throw parseError;
          }
        } catch (error) {
          lastError = error;
          const canRetryWithBiggerBudget =
            tokenIdx < tokenBudgets.length - 1 && isLikelyTruncatedJsonParseError(error);
          if (canRetryWithBiggerBudget) {
            console.log("[parsePdf] responses JSON parsing failed; escalating token budget and retrying", {
              attemptedApiVersion,
              urlStyle: endpointCandidate.urlStyle,
              tokenBudget,
              nextTokenBudget: tokenBudgets[tokenIdx + 1],
              details: String(error?.message || error),
            });
            continue;
          }

          if (!isUnsupportedApiVersionError(error)) {
            const message = String(error?.message || "");
            if (!message.includes("Resource not found")) {
              throw error;
            }
          }
          console.log("[parsePdf] responses pass attempt failed, trying next candidate", {
            attemptedApiVersion,
            urlStyle: endpointCandidate.urlStyle,
            tokenBudget,
            details: String(error?.message || error),
          });
          break;
        }
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
    userPrompt: "Return page-by-page extraction for all report pages with full visible text and no summarization.",
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

async function runResponsesContentPassesSequential({
  endpoint,
  apiKey,
  apiVersion,
  deployment,
  pdfDataUrl,
  onPageError = () => {},
  onSectionError = () => {},
}) {
  const pagesPayload = await runPagesPass({
    endpoint,
    apiKey,
    apiVersion,
    deployment,
    pdfDataUrl,
  }).catch((error) => {
    onPageError(error);
    return { pages: [] };
  });

  await maybeDelayBetweenAzurePasses();

  const sectionsPayload = await runSectionsPass({
    endpoint,
    apiKey,
    apiVersion,
    deployment,
    pdfDataUrl,
  }).catch((error) => {
    onSectionError(error);
    return { sections: [], documentSummary: null };
  });

  return { pagesPayload, sectionsPayload };
}

async function runScoreRescuePass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl }) {
  return runResponsesPass({
    endpoint,
    apiKey,
    apiVersion,
    deployment,
    systemPrompt: SCORE_RESCUE_PROMPT,
    userPrompt: buildScoreRescueUserPrompt("responses-pass"),
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

function collectReportTextForTemplateDetection(parsed) {
  const normalized = normalizeParsedShape(parsed);
  const chunks = [];

  if (normalized?.reportSummary) chunks.push(String(normalized.reportSummary));
  if (normalized?.reportContent?.documentSummary) chunks.push(String(normalized.reportContent.documentSummary));

  (normalized?.reportContent?.pages || []).forEach((page) => {
    if (page?.heading) chunks.push(String(page.heading));
    if (page?.extractedText) chunks.push(String(page.extractedText));
    if (Array.isArray(page?.keyDataPoints) && page.keyDataPoints.length) {
      chunks.push(page.keyDataPoints.join(" "));
    }
  });

  (normalized?.reportContent?.sections || []).forEach((section) => {
    if (section?.sectionTitle) chunks.push(String(section.sectionTitle));
    if (section?.summary) chunks.push(String(section.summary));
    if (section?.fullText) chunks.push(String(section.fullText));
  });

  return chunks
    .join("\n")
    .slice(0, 240_000)
    .toLowerCase();
}

function detectReportTemplate(parsed) {
  const haystack = collectReportTextForTemplateDetection(parsed);
  if (!haystack) return "standard";

  if (
    haystack.includes("individual professional") ||
    haystack.includes("individual-professional") ||
    haystack.includes("ieq9 pro")
  ) {
    return "pro";
  }

  return "standard";
}

function hasProTemplateRequiredFields(parsed) {
  const normalized = normalizeParsedShape(parsed);
  const primaryType = Number(normalized?.primaryType);
  const hasPrimaryType = Number.isInteger(primaryType) && primaryType >= 1 && primaryType <= 9;
  const instinct = String(normalized?.instinctualVariant || "").trim().toLowerCase();
  const hasInstinct = instinct === "sp" || instinct === "sx" || instinct === "so";
  const centerSignalCount = Object.values(normalized?.centerScores || {}).filter((value) => value != null).length;
  const hasCenterSignal = centerSignalCount >= 1;

  return hasPrimaryType && hasInstinct && hasCenterSignal;
}

function getTotalExtractedChars(items, field) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    return sum + String(item?.[field] || "").trim().length;
  }, 0);
}

function sectionCoverageLooksWeak(pages, sections) {
  if (!Array.isArray(pages) || !pages.length) return false;
  if (!Array.isArray(sections) || !sections.length) return true;
  if (sections.length < 5) return true;

  const pageChars = getTotalExtractedChars(pages, "extractedText");
  if (pageChars <= 0) return false;

  const sectionChars = getTotalExtractedChars(sections, "fullText");
  const coverageRatio = sectionChars / pageChars;
  if (coverageRatio < 0.35) return true;

  return sections.some((section) => {
    const text = String(section?.fullText || "").toLowerCase();
    return (
      text.includes("detailed description of the individual's enneagram type") ||
      text.includes("summary of this section")
    );
  });
}

function buildPageSectionsFallback(pages) {
  return (Array.isArray(pages) ? pages : [])
    .map((page) => {
      const pageNumber = Number(page?.pageNumber || 0);
      if (!Number.isInteger(pageNumber) || pageNumber <= 0) return null;
      const fullText = String(page?.extractedText || "").trim();
      if (!fullText) return null;
      const heading = String(page?.heading || "").trim();
      const summary = normalizePdfLayerText(fullText).slice(0, 320) || null;
      return {
        sectionId: `page_${pageNumber}`,
        sectionTitle: heading || `Page ${pageNumber}`,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        summary,
        fullText,
      };
    })
    .filter(Boolean);
}

function mergeSectionsWithPageFallback(pages, sections) {
  if (!sectionCoverageLooksWeak(pages, sections)) {
    return Array.isArray(sections) ? sections : [];
  }
  const existingSections = Array.isArray(sections) ? sections : [];
  const pageSections = buildPageSectionsFallback(pages);
  if (!pageSections.length) return existingSections;

  const keys = new Set(
    existingSections.map((section) => {
      const start = Number(section?.pageStart || 0);
      const end = Number(section?.pageEnd || 0);
      return `${start}-${end}`;
    }),
  );

  const merged = [...existingSections];
  pageSections.forEach((section) => {
    const key = `${section.pageStart}-${section.pageEnd}`;
    if (!keys.has(key)) {
      keys.add(key);
      merged.push(section);
    }
  });
  return merged;
}

function mergeReportContent(baseParsed, pagesPayload, sectionsPayload) {
  const merged = normalizeParsedShape(baseParsed);
  const pages = Array.isArray(pagesPayload?.pages) ? pagesPayload.pages : [];
  const sections = mergeSectionsWithPageFallback(
    pages,
    Array.isArray(sectionsPayload?.sections) ? sectionsPayload.sections : [],
  );
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

function buildScoreRescueUserPrompt(scale) {
  const normalizedScale = Number(scale);
  const scaleText = Number.isFinite(normalizedScale) ? String(normalizedScale) : "default";
  return [
    "Extract exact values from the provided iEQ9 chart pages.",
    "Type Scores: read the spider/radar chart and Type 1-9 bars for type1..type9.",
    "Centers of Expression: head, heart, body (if qualitative only, map High=80, Medium/Moderate=55, Low=25).",
    "Instincts: read 27 Subtypes & Instincts for selfPreservation, sexual (1-on-1), social.",
    "Return strict JSON only in schema: {\"typeScores\":{\"type1\":null,\"type2\":null,\"type3\":null,\"type4\":null,\"type5\":null,\"type6\":null,\"type7\":null,\"type8\":null,\"type9\":null},\"centerScores\":{\"head\":null,\"heart\":null,\"body\":null},\"instinctScores\":{\"selfPreservation\":null,\"sexual\":null,\"social\":null}}.",
    `Render scale used: ${scaleText}.`,
  ].join(" ");
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
    candidate.centerScores[k] = toCenterScore(raw?.centerScores?.[k]);
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
    responseFormatType: "json_schema",
    maxTokens: 7000,
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
    const data = await callAzureModelChatWithEndpointFallback({
      endpoint,
      apiKey,
      apiVersion,
      deployment,
      payload,
    });
    return safeJsonParse(parseChatCompletionsJson(data));
  }
}

async function runPagesPassViaChatImages({
  endpoint,
  apiKey,
  apiVersion,
  deployment,
  pdfBuffer,
  pageCountHint = null,
  batchSize = null,
  renderScale = null,
}) {
  const maxPagesEnvRaw = process.env.PDF_PARSE_IMAGE_MAX_PAGES;
  const maxPagesEnv = Number(maxPagesEnvRaw);
  const batchSizeEnvRaw = Number(process.env.PDF_PARSE_IMAGE_BATCH_SIZE || 0);
  const batchSizeOption = Number(batchSize || 0);
  const resolvedBatchSizeRaw = batchSizeOption > 0 ? batchSizeOption : batchSizeEnvRaw;
  const resolvedBatchSize = Number.isFinite(resolvedBatchSizeRaw) && resolvedBatchSizeRaw > 0
    ? Math.max(1, Math.floor(resolvedBatchSizeRaw))
    : 3;
  const scaleEnvRaw = Number(process.env.PDF_PARSE_IMAGE_SCALE || 0);
  const scaleOption = Number(renderScale || 0);
  const resolvedScaleRaw = scaleOption > 0 ? scaleOption : scaleEnvRaw;
  const resolvedScale = Number.isFinite(resolvedScaleRaw) && resolvedScaleRaw > 0 ? resolvedScaleRaw : 1.6;
  const normalizedHint = Number(pageCountHint);
  const hasPageCountHint = Number.isFinite(normalizedHint) && normalizedHint > 0;
  const pageCount = hasPageCountHint ? Math.floor(normalizedHint) : await getPdfPageCount(pdfBuffer);
  const hasExplicitCap = Number.isFinite(maxPagesEnv) && maxPagesEnv > 0;
  let targetPages = Math.max(pageCount, 0);
  if (hasExplicitCap && targetPages > 0) {
    const cap = Math.floor(maxPagesEnv);
    if (cap < targetPages) {
      console.log("[parsePdf] Ignoring PDF_PARSE_IMAGE_MAX_PAGES to preserve full-page coverage", {
        cap,
        pageCount,
      });
    } else {
      targetPages = Math.min(targetPages, cap);
    }
  }
  console.log("[parsePdf] page extraction target resolved", {
    pageCount,
    usedPageCountHint: hasPageCountHint,
    maxPagesEnvRaw: maxPagesEnvRaw ?? null,
    hasExplicitCap,
    targetPages,
    batchSize: resolvedBatchSize,
    renderScale: resolvedScale,
  });
  if (!targetPages) {
    return { pages: [] };
  }

  const pageNumbers = Array.from({ length: targetPages }, (_v, i) => i + 1);
  const pageBatches = chunkArray(pageNumbers, resolvedBatchSize);
  const outPages = [];
  const failedBatches = [];

  for (const batch of pageBatches) {
    try {
      const imageDataUrls = await rasterizePdfToImageDataUrls(pdfBuffer, {
        maxPages: batch.length,
        pageNumbers: batch,
        scale: resolvedScale,
      });
      const userPrompt = [
        "These images are report pages in this exact order and page numbers:",
        batch.join(", "),
        "Return one page object per image, preserving pageNumber exactly from this list.",
        "Extract heading/title, full visible text, and key data points from each page. Do not summarize.",
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
      } else {
        console.log("[parsePdf] image page batch returned no pages array", {
          batch,
        });
      }
    } catch (error) {
      const details = String(error?.message || error);
      failedBatches.push({ batch, details });
      console.log("[parsePdf] image page batch failed; deferring to single-page retries", {
        batch,
        details,
      });
    }
  }

  // Retry any missed pages one-by-one to avoid silent page drops.
  const seen = new Set(outPages.map((p) => Number(p?.pageNumber)).filter((n) => Number.isInteger(n) && n > 0));
  const missingPages = pageNumbers.filter((n) => !seen.has(n));
  if (missingPages.length > 0) {
    console.log("[parsePdf] image page extraction has missing pages before single-page retries", {
      targetPages: pageNumbers.length,
      extractedPages: seen.size,
      missingPages: missingPages.length,
      failedBatches: failedBatches.length,
    });
  }

  for (const pageNumber of missingPages) {
    const imageDataUrls = await rasterizePdfToImageDataUrls(pdfBuffer, {
      maxPages: 1,
      pageNumbers: [pageNumber],
      scale: resolvedScale,
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
    }).catch((error) => {
      console.log("[parsePdf] single-page retry failed", {
        pageNumber,
        details: String(error?.message || error),
      });
      return { pages: [] };
    });
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

  if (!deduped.length) {
    throw new Error("Image page extraction failed: zero pages extracted.");
  }

  if (deduped.length < pageNumbers.length) {
    const dedupedSet = new Set(
      deduped.map((page) => Number(page?.pageNumber)).filter((n) => Number.isInteger(n) && n > 0),
    );
    const stillMissingPages = pageNumbers.filter((n) => !dedupedSet.has(n));
    console.log("[parsePdf] image page extraction completed with missing pages", {
      targetPages: pageNumbers.length,
      extractedPages: deduped.length,
      missingPages: stillMissingPages.length,
      stillMissingSample: stillMissingPages.slice(0, 20),
      failedBatches: failedBatches.length,
    });
  }

  return { pages: deduped };
}

async function runSectionsFromPagesViaChat({ endpoint, apiKey, apiVersion, deployment, pagesPayload }) {
  const pages = Array.isArray(pagesPayload?.pages) ? pagesPayload.pages : [];
  if (!pages.length) {
    return { sections: [], documentSummary: null };
  }
  const maxCharsPerPageRaw = Number(process.env.PDF_SECTION_INPUT_MAX_CHARS_PER_PAGE || 6000);
  const maxCharsPerPage = Number.isFinite(maxCharsPerPageRaw) && maxCharsPerPageRaw > 0
    ? Math.floor(maxCharsPerPageRaw)
    : 6000;
  const compactPagesText = pages
    .map((p) => {
      const heading = String(p?.heading || "");
      const text = String(p?.extractedText || "");
      const excerpt = text.slice(0, maxCharsPerPage);
      const wasTruncated = text.length > excerpt.length;
      const points = Array.isArray(p?.keyDataPoints) ? p.keyDataPoints.join("; ") : "";
      return `Page ${p?.pageNumber ?? "?"}\nHeading: ${heading}\nText: ${excerpt}${wasTruncated ? "\n[Text truncated for request size safety]" : ""}\nPoints: ${points}`;
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
        userPrompt: buildScoreRescueUserPrompt(scale),
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

async function parseViaChatCompletions({
  endpoint,
  apiKey,
  apiVersion,
  deployment,
  pdfDataUrl,
  pdfBuffer,
  allowImageFallback = true,
}) {
  const userPrompt = "Extract all data from this iEQ9 report into the requested schema.";
  const payload = buildChatPayload({
    systemPrompt: CORE_SYSTEM_PROMPT,
    userPrompt,
    imagesOrPdfDataUrl: pdfDataUrl,
    responseFormatType: "json_object",
    maxTokens: 4096,
  });
  const legacyUrl = buildAzureDeploymentChatUrl(endpoint, deployment, apiVersion);
  try {
    const data = await callAzureWithRetry(legacyUrl, apiKey, payload);
    return normalizeParsedShape(parseChatCompletionsJson(data));
  } catch (legacyError) {
    if (isPdfMimeUnsupportedForImageUrlError(legacyError) && allowImageFallback) {
      console.log("[parsePdf] legacy chat endpoint rejected application/pdf image_url. Attempting PDF->image fallback.");
      const imageDataUrls = await rasterizePdfToImageDataUrls(pdfBuffer);
      const imagePayload = buildChatPayload({
        systemPrompt: CORE_SYSTEM_PROMPT,
        userPrompt,
        imagesOrPdfDataUrl: imageDataUrls,
        model: deployment,
        responseFormatType: "json_object",
        maxTokens: 4096,
      });
      const data = await callAzureWithRetry(legacyUrl, apiKey, imagePayload);
      return normalizeParsedShape(parseChatCompletionsJson(data));
    }

    console.log("[parsePdf] legacy deployment chat endpoint failed, trying model-based chat endpoint", {
      details: String(legacyError?.message || legacyError),
    });
    try {
      const data = await callAzureModelChatWithEndpointFallback({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        payload,
      });
      return normalizeParsedShape(parseChatCompletionsJson(data));
    } catch (modelError) {
      if (!isPdfMimeUnsupportedForImageUrlError(modelError) || !allowImageFallback) {
        throw modelError;
      }

      console.log("[parsePdf] chat endpoint rejected application/pdf image_url. Attempting PDF->image fallback.");
      const imageDataUrls = await rasterizePdfToImageDataUrls(pdfBuffer);
      const imagePayload = buildChatPayload({
        systemPrompt: CORE_SYSTEM_PROMPT,
        userPrompt,
        imagesOrPdfDataUrl: imageDataUrls,
        model: deployment,
        responseFormatType: "json_object",
        maxTokens: 4096,
      });
      const data = await callAzureModelChatWithEndpointFallback({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        payload: imagePayload,
      });
      return normalizeParsedShape(parseChatCompletionsJson(data));
    }
  }
}

export async function parsePdf(input, options = {}) {
  const pdfBuffer = toUint8Array(input);
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || "";
  const apiKey = process.env.AZURE_OPENAI_API_KEY || "";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-11-20";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4o";
  const disableImagePipeline = Boolean(options?.disableImagePipeline);
  const disableImageScoreRescue = Boolean(options?.disableImageScoreRescue ?? disableImagePipeline);
  const requireChartScoresForComplete = options?.requireChartScoresForComplete == null
    ? String(process.env.PDF_PARSE_REQUIRE_CHART_SCORES || "true").toLowerCase() !== "false"
    : Boolean(options.requireChartScoresForComplete);
  const configuredMinExpectedPagesRaw = Number(process.env.PDF_PARSE_MIN_PAGES || 20);
  const configuredMinExpectedPages = Number.isFinite(configuredMinExpectedPagesRaw) && configuredMinExpectedPagesRaw > 0
    ? Math.floor(configuredMinExpectedPagesRaw)
    : 20;
  const imagePrimaryPageLimitRaw = Number(
    options?.imagePrimaryFullDocMaxPages ?? process.env.PDF_PARSE_IMAGE_FULL_DOC_MAX_PAGES ?? 0,
  );
  const imagePrimaryFullDocMaxPages = Number.isFinite(imagePrimaryPageLimitRaw) && imagePrimaryPageLimitRaw > 0
    ? Math.floor(imagePrimaryPageLimitRaw)
    : 0;
  const imageBatchSizeRaw = Number(options?.imagePageBatchSize ?? process.env.PDF_PARSE_IMAGE_BATCH_SIZE ?? 0);
  const imagePageBatchSize = Number.isFinite(imageBatchSizeRaw) && imageBatchSizeRaw > 0
    ? Math.floor(imageBatchSizeRaw)
    : null;
  const imageScaleRaw = Number(options?.imageRenderScale ?? process.env.PDF_PARSE_IMAGE_SCALE ?? 0);
  const imageRenderScale = Number.isFinite(imageScaleRaw) && imageScaleRaw > 0 ? imageScaleRaw : null;

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
      mode: disableImagePipeline ? "responses-primary" : "image-primary",
      pages: 0,
      sections: 0,
      detectedTotalPages: null,
      minExpectedPages: configuredMinExpectedPages,
      imagePrimaryFullDocMaxPages,
      imagePageBatchSize,
      imageRenderScale,
      requireChartScoresForComplete,
      effectiveRequireChartScores: requireChartScoresForComplete,
      reportTemplate: "standard",
      proTemplateRequiredFieldsSatisfied: null,
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

  let useImagePrimaryPass = !disableImagePipeline;
  let detectedTotalPages = 0;
  try {
    detectedTotalPages = await getPdfPageCount(pdfBuffer);
    diagnostics.extraction.detectedTotalPages = detectedTotalPages;
    if (detectedTotalPages > 0) {
      diagnostics.extraction.minExpectedPages = Math.max(configuredMinExpectedPages, detectedTotalPages);
    }
    pushStep("pdf_page_count_detected", {
      detectedTotalPages,
      minExpectedPages: diagnostics.extraction.minExpectedPages,
    });
  } catch (pageCountError) {
    pushWarning("pdf_page_count_detection_failed", String(pageCountError?.message || pageCountError));
    console.log("[parsePdf] PDF page count detection failed", {
      details: String(pageCountError?.message || pageCountError),
    });
  }

  if (useImagePrimaryPass && imagePrimaryFullDocMaxPages > 0 && detectedTotalPages > imagePrimaryFullDocMaxPages) {
    useImagePrimaryPass = false;
    diagnostics.extraction.mode = "responses-primary-large-doc";
    pushWarning(
      "image_primary_skipped_for_large_document",
      `Detected ${detectedTotalPages} pages exceeds image primary limit ${imagePrimaryFullDocMaxPages}`,
    );
    pushStep("image_primary_skipped_for_large_document", {
      detectedTotalPages,
      imagePrimaryFullDocMaxPages,
    });
  } else if (!useImagePrimaryPass) {
    diagnostics.extraction.mode = "responses-primary";
  }

  let deterministicPagesPayload = { pages: [] };
  try {
    deterministicPagesPayload = await extractPagesTextFromPdfLayer(pdfBuffer);
    pushStep("pdf_text_layer_extract_succeeded", {
      pages: Array.isArray(deterministicPagesPayload?.pages) ? deterministicPagesPayload.pages.length : 0,
    });
  } catch (textExtractError) {
    pushWarning("pdf_text_layer_extract_failed", String(textExtractError?.message || textExtractError));
    console.log("[parsePdf] deterministic PDF text extraction failed", {
      details: String(textExtractError?.message || textExtractError),
    });
  }

  let parsed = null;
  try {
    parsed = await runCorePass({ endpoint, apiKey, apiVersion, deployment, pdfDataUrl });
    console.log("[parsePdf] Core pass succeeded");
    pushStep("core_pass_succeeded");

    // Primary strategy: image-based extraction, unless explicitly disabled or skipped for large-doc safety.
    let pagesPayload = { pages: [] };
    let sectionsPayload = { sections: [], documentSummary: null };
    if (useImagePrimaryPass) {
      try {
        pagesPayload = await runPagesPassViaChatImages({
          endpoint,
          apiKey,
          apiVersion,
          deployment,
          pdfBuffer,
          pageCountHint: detectedTotalPages,
          batchSize: imagePageBatchSize,
          renderScale: imageRenderScale,
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
        const responsesContent = await runResponsesContentPassesSequential({
          endpoint,
          apiKey,
          apiVersion,
          deployment,
          pdfDataUrl,
          onPageError: (error) => {
            pushWarning("responses_page_pass_failed", String(error?.message || error));
            console.log("[parsePdf] Page pass failed", { details: String(error?.message || error) });
          },
          onSectionError: (error) => {
            pushWarning("responses_section_pass_failed", String(error?.message || error));
            console.log("[parsePdf] Section pass failed", { details: String(error?.message || error) });
          },
        });
        pagesPayload = responsesContent.pagesPayload;
        sectionsPayload = responsesContent.sectionsPayload;
        pushStep("responses_content_fallback_applied", {
          pages: Array.isArray(pagesPayload?.pages) ? pagesPayload.pages.length : 0,
          sections: Array.isArray(sectionsPayload?.sections) ? sectionsPayload.sections.length : 0,
        });
      }
    } else {
      const responsesContent = await runResponsesContentPassesSequential({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
        pdfDataUrl,
        onPageError: (error) => {
          pushWarning("responses_page_pass_failed", String(error?.message || error));
          console.log("[parsePdf] Page pass failed", { details: String(error?.message || error) });
        },
        onSectionError: (error) => {
          pushWarning("responses_section_pass_failed", String(error?.message || error));
          console.log("[parsePdf] Section pass failed", { details: String(error?.message || error) });
        },
      });
      pagesPayload = responsesContent.pagesPayload;
      sectionsPayload = responsesContent.sectionsPayload;
      pushStep("responses_content_primary_applied", {
        pages: Array.isArray(pagesPayload?.pages) ? pagesPayload.pages.length : 0,
        sections: Array.isArray(sectionsPayload?.sections) ? sectionsPayload.sections.length : 0,
      });
    }

    pagesPayload = mergePagesWithPdfTextLayer(pagesPayload, deterministicPagesPayload);
    pushStep("pdf_text_layer_merge_applied", {
      pages: Array.isArray(pagesPayload?.pages) ? pagesPayload.pages.length : 0,
    });
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
      allowImageFallback: useImagePrimaryPass,
    });
    pushStep("chat_core_fallback_succeeded");
  }

  const hasAnyPages = Array.isArray(parsed?.reportContent?.pages) && parsed.reportContent.pages.length > 0;
  if (!hasAnyPages && Array.isArray(deterministicPagesPayload?.pages) && deterministicPagesPayload.pages.length > 0) {
    parsed = mergeReportContent(parsed, deterministicPagesPayload, {
      sections: Array.isArray(parsed?.reportContent?.sections) ? parsed.reportContent.sections : [],
      documentSummary: parsed?.reportContent?.documentSummary ?? parsed?.reportSummary ?? null,
    });
    parsed = fillNullScoresFromCandidate(parsed, extractScoresFromTextContent(parsed.reportContent));
    pushStep("pdf_text_layer_content_seeded", {
      pages: Array.isArray(parsed?.reportContent?.pages) ? parsed.reportContent.pages.length : 0,
      sections: Array.isArray(parsed?.reportContent?.sections) ? parsed.reportContent.sections.length : 0,
    });
  }

  if (isWeakExtractedContent(parsed)) {
    if (useImagePrimaryPass) {
      try {
        console.log("[parsePdf] Running image-based full-content extraction after fallback path.");
        const imagePagesPayload = await runPagesPassViaChatImages({
          endpoint,
          apiKey,
          apiVersion,
          deployment,
          pdfBuffer,
          pageCountHint: detectedTotalPages,
          batchSize: imagePageBatchSize,
          renderScale: imageRenderScale,
        });
        const imageSectionsPayload = await runSectionsFromPagesViaChat({
          endpoint,
          apiKey,
          apiVersion,
          deployment,
          pagesPayload: imagePagesPayload,
        });
        const mergedImagePagesPayload = mergePagesWithPdfTextLayer(imagePagesPayload, deterministicPagesPayload);
        parsed = mergeReportContent(parsed, mergedImagePagesPayload, imageSectionsPayload);
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
    } else {
      pushStep("post_fallback_image_content_skipped", {
        reason: "image_pipeline_disabled_or_large_doc_guard",
      });
    }
  }

  const reportTemplate = detectReportTemplate(parsed);
  const isProTemplate = reportTemplate === "pro";
  const proTemplateRequiredFieldsSatisfied = isProTemplate ? hasProTemplateRequiredFields(parsed) : true;
  const effectiveRequireChartScores = requireChartScoresForComplete && !isProTemplate;
  diagnostics.extraction.reportTemplate = reportTemplate;
  diagnostics.extraction.proTemplateRequiredFieldsSatisfied = proTemplateRequiredFieldsSatisfied;
  diagnostics.extraction.effectiveRequireChartScores = effectiveRequireChartScores;
  if (isProTemplate && requireChartScoresForComplete) {
    pushStep("pro_template_chart_requirement_relaxed", {
      reportTemplate,
      reason: "numeric chart arrays are optional for PRO template completion",
    });
  }

  // Chart numerics: image-only rescue on chart-centric pages.
  if (needsScoreRescue(parsed)) {
    if (!effectiveRequireChartScores) {
      pushStep("image_score_rescue_skipped", {
        reason: isProTemplate ? "pro_template_numeric_scores_optional" : "chart_scores_not_required",
      });
    } else if (!disableImageScoreRescue) {
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
    } else {
      pushStep("image_score_rescue_skipped", {
        reason: "image_score_rescue_disabled",
      });
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
  } else if (isProTemplate && !proTemplateRequiredFieldsSatisfied) {
    diagnostics.isComplete = false;
    diagnostics.incompleteReason =
      "PRO report parse incomplete: missing one or more required fields (primaryType, instinctualVariant, centers)";
    pushError("parse_incomplete_missing_pro_required_fields", diagnostics.incompleteReason);
  } else if (effectiveRequireChartScores && !hasFullChartScores) {
    diagnostics.isComplete = false;
    diagnostics.incompleteReason =
      "Chart numerics incomplete: one or more type, instinct, or center scores are null";
    pushError("parse_incomplete_missing_chart_scores", diagnostics.incompleteReason);
  } else {
    diagnostics.isComplete = true;
    if (!hasFullChartScores) {
      pushWarning(
        "parse_complete_missing_chart_scores",
        "Page coverage complete; chart numerics remain partially null and should be reviewed.",
      );
    }
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
