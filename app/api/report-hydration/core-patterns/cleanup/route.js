import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENAI_RETRY_BASE_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const RETRYABLE_HTTP_STATUS_CODES = new Set([408, 409, 429]);
const STREAM_DISCONNECT_ERROR_SIGNATURE = "stream disconnected before completion: response.failed event received";
const OPENAI_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const OPENAI_MAX_COMPLETION_TOKENS = 900;
const CORE_PATTERN_MAX_TEXT_CHARS = 2200;
const CORE_PATTERN_FALLBACK_TEXT = "Not detected in assigned PDF.";
const CORE_PATTERN_SECTION_BOUNDARY_MARKERS = [
  "Blind Spots",
  "BlindSpots",
  "Worldview",
  "World View",
  "Detailed Enneagram Description",
  "Your main Enneagram style",
  "Focus of Attention",
  "Core Fear",
  "Self-Talk",
  "Self Talk",
  "Gifts",
  "Vices",
  "Development Exercise",
  "DEVELOPMENT EXERCISE",
];
const CORE_PATTERN_DEFINITIONS = Object.freeze([
  { key: "action", label: "Typical Action Patterns" },
  { key: "thinking", label: "Typical Thinking Patterns" },
  { key: "feeling", label: "Typical Feeling Patterns" },
]);

const CORE_PATTERN_CLEANUP_SYSTEM_PROMPT = `
You clean extracted Enneagram core-pattern section text during dashboard hydration.

Input contains three sections:
- Typical Action Patterns
- Typical Thinking Patterns
- Typical Feeling Patterns

Required behavior:
1. Preserve original wording and sentence order whenever possible.
2. Repair missing word boundaries so words are readable.
3. Remove text that belongs to other sections.
4. Exclude spillover content and everything after these headings when they appear:
   Blind Spots, Worldview, World View, Detailed Enneagram Description,
   Your main Enneagram style, Focus of Attention, Core Fear, Self-Talk, Self Talk, Gifts, Vices.
5. Return JSON only in the schema shape with all three keys.
6. If a section has no valid content, return "${CORE_PATTERN_FALLBACK_TEXT}".
`.trim();

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStringOrNull(value) {
  const normalized = normalizeWhitespace(value);
  return normalized || null;
}

function isMissingSectionText(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "not detected" ||
    normalized === "unknown" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "none" ||
    normalized.includes("not detected in assigned pdf")
  );
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCorePatternBoundarySpillover(value) {
  let cleaned = normalizeWhitespace(value);
  if (!cleaned) return null;
  cleaned = cleaned
    .replace(/^\s*Typical\s*(?:Action|Thinking|Feeling)\s*Patterns?\s*[:\-]?\s*/i, "")
    .trim();
  if (!cleaned) return null;

  const markerPattern = new RegExp(
    `\\b(?:${CORE_PATTERN_SECTION_BOUNDARY_MARKERS.map((marker) => escapeRegex(marker)).join("|")})\\b`,
    "i",
  );
  const spilloverMatch = markerPattern.exec(cleaned);
  if (spilloverMatch) {
    const boundaryIndex = Number(spilloverMatch.index || 0);
    if (boundaryIndex === 0) return null;
    cleaned = cleaned.slice(0, boundaryIndex).trim();
  }

  return cleaned || null;
}

function normalizeCorePatternKey(row, index) {
  const key = normalizeWhitespace(row?.key).toLowerCase();
  if (key === "action" || key === "thinking" || key === "feeling") return key;
  const label = normalizeWhitespace(row?.label).toLowerCase();
  if (label.includes("action")) return "action";
  if (label.includes("thinking")) return "thinking";
  if (label.includes("feeling")) return "feeling";
  if (index === 0) return "action";
  if (index === 1) return "thinking";
  if (index === 2) return "feeling";
  return null;
}

function normalizeCorePatternBulletsInput(value) {
  const rows = Array.isArray(value) ? value : [];
  const byKey = new Map();

  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const key = normalizeCorePatternKey(row, index);
    if (!key) return;
    const cleanedText = stripCorePatternBoundarySpillover(String(row?.text || "").slice(0, CORE_PATTERN_MAX_TEXT_CHARS));
    if (!cleanedText || isMissingSectionText(cleanedText)) return;
    byKey.set(key, cleanedText);
  });

  return CORE_PATTERN_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    text: byKey.get(definition.key) || CORE_PATTERN_FALLBACK_TEXT,
  }));
}

function extractMessageContent(message) {
  if (!message) return "";
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (typeof part.text === "string") return part.text;
          if (typeof part.value === "string") return part.value;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function parseJsonFromContent(content) {
  const text = String(content || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_nestedError) {
      return null;
    }
  }
}

function parseCorePatternBulletsFromOpenAiResponse(payload) {
  const firstChoice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const message = firstChoice?.message && typeof firstChoice.message === "object" ? firstChoice.message : null;
  if (message?.parsed && typeof message.parsed === "object") {
    return normalizeCorePatternBulletsInput(message.parsed?.bullets);
  }
  const content = extractMessageContent(message);
  const parsed = parseJsonFromContent(content);
  return normalizeCorePatternBulletsInput(parsed?.bullets);
}

function isRetryableStatus(status) {
  const numeric = Number(status);
  return RETRYABLE_HTTP_STATUS_CODES.has(numeric) || (numeric >= 500 && numeric <= 599);
}

function classifyRetryableError({ status, error }) {
  const numericStatus = Number(status);
  if (Number.isFinite(numericStatus) && numericStatus > 0) return `http_${numericStatus}`;
  const lowered = String(error?.message || error || "").toLowerCase();
  if (lowered.includes(STREAM_DISCONNECT_ERROR_SIGNATURE)) return "stream_disconnect";
  if (lowered.includes("abort") || lowered.includes("timeout")) return "timeout";
  if (
    lowered.includes("fetch failed") ||
    lowered.includes("network") ||
    lowered.includes("socket") ||
    lowered.includes("econn") ||
    lowered.includes("enotfound") ||
    lowered.includes("eai_again")
  ) {
    return "connection";
  }
  const retryableStatusMatch = lowered.match(/\b(408|409|429|5\d\d)\b/);
  if (retryableStatusMatch?.[1]) return `http_${retryableStatusMatch[1]}`;
  return "unknown";
}

function isRetryableFetchError(error) {
  const lowered = String(error?.message || error || "").toLowerCase();
  if (!lowered) return false;
  if (lowered.includes(STREAM_DISCONNECT_ERROR_SIGNATURE)) return true;
  if (
    lowered.includes("abort") ||
    lowered.includes("timeout") ||
    lowered.includes("fetch failed") ||
    lowered.includes("network") ||
    lowered.includes("socket") ||
    lowered.includes("econn") ||
    lowered.includes("enotfound") ||
    lowered.includes("eai_again")
  ) {
    return true;
  }
  return /\b(408|409|429|5\d\d)\b/.test(lowered);
}

function computeRetryDelayMs(attemptIndex) {
  const baseDelayMs = OPENAI_RETRY_BASE_DELAYS_MS[
    Math.min(attemptIndex, OPENAI_RETRY_BASE_DELAYS_MS.length - 1)
  ];
  const jitterRatio = 0.8 + Math.random() * 0.4;
  return Math.min(20_000, Math.max(0, Math.round(baseDelayMs * jitterRatio)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOpenAiRequestPayload({ bullets, detectedType, reportFileName, reportId }) {
  const modelInput = {
    detectedType: normalizeStringOrNull(detectedType),
    reportFileName: normalizeStringOrNull(reportFileName),
    reportId: normalizeStringOrNull(reportId),
    bullets,
  };

  return {
    messages: [
      { role: "system", content: CORE_PATTERN_CLEANUP_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Clean these core-pattern bullets for hydration:\n${JSON.stringify(modelInput, null, 2)}`,
      },
    ],
    temperature: 0,
    max_completion_tokens: OPENAI_MAX_COMPLETION_TOKENS,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "core_pattern_hydration_cleanup",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["bullets"],
          properties: {
            bullets: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "label", "text"],
                properties: {
                  key: { type: "string", enum: ["action", "thinking", "feeling"] },
                  label: {
                    type: "string",
                    enum: [
                      "Typical Action Patterns",
                      "Typical Thinking Patterns",
                      "Typical Feeling Patterns",
                    ],
                  },
                  text: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  };
}

async function requestOpenAiCleanupWithRetry({ openAiUrl, apiKey, requestPayload }) {
  const maxRetries = OPENAI_RETRY_BASE_DELAYS_MS.length;
  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    const attempt = attemptIndex + 1;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error("core-pattern hydration openai request timeout"));
    }, OPENAI_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(openAiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        const retryable = isRetryableStatus(response.status);
        const errorClass = classifyRetryableError({ status: response.status });
        if (retryable && attemptIndex < maxRetries) {
          const delayMs = computeRetryDelayMs(attemptIndex);
          console.log("[core-pattern-hydration] Retrying OpenAI cleanup after HTTP failure", {
            attempt,
            delayMs,
            errorClass,
            status: response.status,
            responseTextPreview: String(responseText || "").slice(0, 300),
          });
          await sleep(delayMs);
          continue;
        }
        throw new Error(
          `Azure OpenAI core-pattern cleanup failed (${response.status}): ${String(responseText || "").slice(0, 400)}`,
        );
      }
      const payload = await response.json();
      return payload;
    } catch (error) {
      const retryable = isRetryableFetchError(error);
      const errorClass = classifyRetryableError({ error });
      if (retryable && attemptIndex < maxRetries) {
        const delayMs = computeRetryDelayMs(attemptIndex);
        console.log("[core-pattern-hydration] Retrying OpenAI cleanup after transient failure", {
          attempt,
          delayMs,
          errorClass,
          details: String(error?.message || error || "Unknown OpenAI cleanup error"),
        });
        await sleep(delayMs);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new Error("OpenAI cleanup retry attempts exhausted.");
}

export async function POST(request) {
  let payload = null;
  try {
    payload = await request.json();
  } catch (_error) {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body.", bullets: normalizeCorePatternBulletsInput([]) },
      { status: 400 },
    );
  }

  const inputBullets = normalizeCorePatternBulletsInput(payload?.bullets);
  const detectedType = normalizeStringOrNull(payload?.detectedType);
  const reportFileName = normalizeStringOrNull(payload?.reportFileName);
  const reportId = normalizeStringOrNull(payload?.reportId);
  const hasInformativeInput = inputBullets.some((row) => !isMissingSectionText(row?.text));

  console.log("[core-pattern-hydration] Received LLM cleanup request", {
    reportId,
    reportFileName,
    detectedType,
    hasInformativeInput,
    sectionKeys: inputBullets.map((row) => row.key),
    boundaryMarkers: CORE_PATTERN_SECTION_BOUNDARY_MARKERS,
  });

  if (!hasInformativeInput) {
    return NextResponse.json(
      {
        success: false,
        usedFallback: true,
        reason: "no_informative_sections",
        bullets: inputBullets,
      },
      { status: 200 },
    );
  }

  const endpoint = normalizeStringOrNull(process.env.AZURE_OPENAI_ENDPOINT);
  const deployment = normalizeStringOrNull(process.env.AZURE_OPENAI_DEPLOYMENT_NAME);
  const apiKey = normalizeStringOrNull(process.env.AZURE_OPENAI_API_KEY);
  const apiVersion = normalizeStringOrNull(process.env.AZURE_OPENAI_API_VERSION) || "2024-08-01-preview";

  if (!endpoint || !deployment || !apiKey) {
    console.log("[core-pattern-hydration] Missing Azure OpenAI env vars; skipping LLM cleanup", {
      hasEndpoint: Boolean(endpoint),
      hasDeployment: Boolean(deployment),
      hasApiKey: Boolean(apiKey),
    });
    return NextResponse.json(
      {
        success: false,
        usedFallback: true,
        reason: "missing_openai_env",
        bullets: inputBullets,
      },
      { status: 200 },
    );
  }

  const openAiUrl = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const openAiRequestPayload = buildOpenAiRequestPayload({
    bullets: inputBullets,
    detectedType,
    reportFileName,
    reportId,
  });

  try {
    const openAiPayload = await requestOpenAiCleanupWithRetry({
      openAiUrl,
      apiKey,
      requestPayload: openAiRequestPayload,
    });
    const cleanedBullets = parseCorePatternBulletsFromOpenAiResponse(openAiPayload);
    const resolvedBullets = normalizeCorePatternBulletsInput(cleanedBullets);
    console.log("[core-pattern-hydration] LLM cleanup completed", {
      reportId,
      reportFileName,
      detectedType,
      model: String(openAiPayload?.model || deployment),
      hasCleanedOutput: resolvedBullets.some((row) => !isMissingSectionText(row?.text)),
    });
    return NextResponse.json(
      {
        success: true,
        usedFallback: false,
        model: String(openAiPayload?.model || deployment),
        provider: `azure-openai:${deployment}`,
        bullets: resolvedBullets,
      },
      { status: 200 },
    );
  } catch (error) {
    console.log("[core-pattern-hydration] LLM cleanup failed; returning deterministic fallback", {
      reportId,
      reportFileName,
      detectedType,
      errorClass: classifyRetryableError({ error }),
      details: String(error?.message || error || "Unknown cleanup error"),
      stack: error?.stack,
    });
    return NextResponse.json(
      {
        success: false,
        usedFallback: true,
        reason: "openai_cleanup_failed",
        error: String(error?.message || "OpenAI cleanup failed"),
        bullets: inputBullets,
      },
      { status: 200 },
    );
  }
}
