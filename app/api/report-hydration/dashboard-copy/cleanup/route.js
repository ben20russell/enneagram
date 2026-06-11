import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENAI_RETRY_BASE_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const RETRYABLE_HTTP_STATUS_CODES = new Set([408, 409, 429]);
const STREAM_DISCONNECT_ERROR_SIGNATURE = "stream disconnected before completion: response.failed event received";
const OPENAI_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const OPENAI_MAX_COMPLETION_TOKENS = 1800;
const MAX_TEXT_CHARS = 2200;
const MAX_EXERCISE_ITEMS = 12;
const MAX_BULLET_ITEMS = 16;
const FALLBACK_TEXT = "Not detected in assigned PDF.";
const STRAIN_CATEGORIES = [
  "Happiness",
  "Vocational",
  "Interpersonal",
  "Physical",
  "Environmental",
  "Psychological",
];
const INSTINCT_FIELDS = ["selfPres", "social", "oneOnOne"];
const SPREADSHEET_TEXT_KEYS = [
  "motivationSummary",
  "developingAsCopy",
  "conflictResponseCopy",
  "conflictTriggeredCopy",
  "centeredDecisionCopy",
  "decisionImpactCopy",
  "decisionStrainCopy",
  "strategicLeadershipCopy",
  "teamImpactCopy",
  "interdependenceCopy",
  "coachingRelationshipCopy",
];
const TEAM_STAGE_KEYS = ["forming", "storming", "norming", "performing"];
const CORE_PATTERN_BULLET_DEFINITIONS = [
  { key: "action", label: "Typical Action Patterns" },
  { key: "thinking", label: "Typical Thinking Patterns" },
  { key: "feeling", label: "Typical Feeling Patterns" },
];

const DASHBOARD_COPY_CLEANUP_SYSTEM_PROMPT = `
You clean jumbled Enneagram dashboard narrative copy during hydration.

You must:
1. Preserve original meaning and sentence order whenever possible.
2. Repair OCR/formatting artifacts (broken word boundaries, symbol noise like ≡, duplicated headings, malformed punctuation).
3. Never invent new Enneagram claims or advice.
4. Keep each field isolated:
   - social must remain Social-only text and must not include "One-On-One - SX" or "Self-Preservation - SP" sections.
   - oneOnOne must remain One-On-One/SX-only text.
   - selfPres must remain Self-Preservation/SP-only text.
5. For strain category rows, keep only the matching category narrative.
6. Remove heading spillover like "Development Exercise", "Exercise 1", "One-On-One - SX", "Social - SO", "Self-Preservation - SP" when they are artifacts.
7. Return JSON only in the exact schema shape.
8. If a field has no valid content after cleanup, return "${FALLBACK_TEXT}".
9. For corePatternBullets, preserve exactly three rows labeled "Typical Action Patterns", "Typical Thinking Patterns", and "Typical Feeling Patterns".
`.trim();

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/[≡]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value, { fallback = null, maxChars = MAX_TEXT_CHARS } = {}) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return fallback;
  if (Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 && normalized.length > Number(maxChars)) {
    return normalized.slice(0, Number(maxChars)).trim();
  }
  return normalized;
}

function isMissingText(value) {
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

function dedupeRows(rows, maxItems = 12) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const out = [];
  const seen = new Set();
  const max = Number.isFinite(Number(maxItems)) ? Math.max(1, Number(maxItems)) : 12;
  for (const row of safeRows) {
    const normalized = normalizeText(row, { fallback: null });
    if (!normalized || isMissingText(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

function truncateAtFirstHeadingLeak(text, { fieldKey } = {}) {
  const normalized = normalizeText(text, { fallback: null });
  if (!normalized) return null;
  const key = String(fieldKey || "").trim().toLowerCase();
  let cleaned = normalized
    .replace(/^\s*Development\s*Exercise\s*[:\-]?\s*/i, "")
    .replace(/^\s*Exercise\s*\d+\s*[:\-]?\s*/i, "")
    .trim();

  if (!cleaned) return null;

  const headingPattern = /\b(?:One(?:-| )On(?:-| )One\s*-\s*SX|Social\s*-\s*SO|Self(?:-| )Preservation\s*-\s*SP)\b/gi;
  const matches = Array.from(cleaned.matchAll(headingPattern));
  if (!matches.length) return cleaned;

  const firstHeading = matches[0];
  const firstHeadingIndex = Number(firstHeading?.index || 0);
  const firstHeadingLabel = String(firstHeading?.[0] || "");
  const startsWithHeading = firstHeadingIndex === 0;

  if (!startsWithHeading) {
    cleaned = cleaned.slice(0, firstHeadingIndex).trim();
    return cleaned || null;
  }

  const normalizedHeading = firstHeadingLabel.toLowerCase();
  if (
    (key === "social" && /social\s*-\s*so/.test(normalizedHeading)) ||
    (key === "oneonone" && /one(?:-| )on(?:-| )one\s*-\s*sx/.test(normalizedHeading)) ||
    (key === "selfpres" && /self(?:-| )preservation\s*-\s*sp/.test(normalizedHeading))
  ) {
    cleaned = cleaned
      .replace(/^\s*(?:One(?:-| )On(?:-| )One\s*-\s*SX|Social\s*-\s*SO|Self(?:-| )Preservation\s*-\s*SP)\s*[:\-]?\s*/i, "")
      .trim();
    if (!cleaned) return null;
    const nextHeadingMatch = headingPattern.exec(cleaned);
    if (nextHeadingMatch && Number(nextHeadingMatch.index || 0) > 0) {
      cleaned = cleaned.slice(0, Number(nextHeadingMatch.index || 0)).trim();
    }
    return cleaned || null;
  }

  return null;
}

function normalizeStrainRowsInput(value) {
  const safeRows = Array.isArray(value) ? value : [];
  return STRAIN_CATEGORIES.map((category) => {
    const matched = safeRows.find(
      (row) => String(row?.category || "").trim().toLowerCase() === String(category).toLowerCase(),
    );
    const text = normalizeText(matched?.text, { fallback: null });
    return {
      category,
      text: text || FALLBACK_TEXT,
    };
  });
}

function normalizeDevelopmentExercisesInput(value) {
  const safeRows = Array.isArray(value) ? value : [];
  const rows = [];
  const seen = new Set();
  for (const row of safeRows) {
    const title = normalizeText(row?.title, { fallback: null, maxChars: 100 }) || `Exercise ${rows.length + 1}`;
    const text = truncateAtFirstHeadingLeak(row?.text, { fieldKey: "exercise" }) || normalizeText(row?.text, { fallback: null });
    if (!text || isMissingText(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ title, text });
    if (rows.length >= MAX_EXERCISE_ITEMS) break;
  }
  if (!rows.length) {
    return [{ title: "Exercise 1", text: FALLBACK_TEXT }];
  }
  return rows;
}

function normalizeFeedbackGuideMatrixInput(value) {
  const safeRows = Array.isArray(value) ? value : [];
  const rows = [];
  for (const row of safeRows) {
    const type = normalizeText(row?.type, { fallback: null, maxChars: 80 }) || `Type ${rows.length + 1}`;
    const label = normalizeText(row?.label, { fallback: "", maxChars: 80 }) || "";
    const guidance = normalizeText(row?.guidance, { fallback: null }) || FALLBACK_TEXT;
    rows.push({ type, label, guidance });
    if (rows.length >= 9) break;
  }
  if (!rows.length) {
    return Array.from({ length: 9 }, (_, index) => ({
      type: `Type ${index + 1}`,
      label: "",
      guidance: FALLBACK_TEXT,
    }));
  }
  return rows;
}

function normalizeSpreadsheetFocusesInput(value) {
  const safe = value && typeof value === "object" ? value : {};
  const instinctGoalsRaw = safe?.instinctGoals && typeof safe.instinctGoals === "object" ? safe.instinctGoals : {};
  const instinctGoals = {
    selfPres:
      truncateAtFirstHeadingLeak(instinctGoalsRaw?.selfPres, { fieldKey: "selfPres" }) ||
      normalizeText(instinctGoalsRaw?.selfPres, { fallback: null }) ||
      FALLBACK_TEXT,
    social:
      truncateAtFirstHeadingLeak(instinctGoalsRaw?.social, { fieldKey: "social" }) ||
      normalizeText(instinctGoalsRaw?.social, { fallback: null }) ||
      FALLBACK_TEXT,
    oneOnOne:
      truncateAtFirstHeadingLeak(instinctGoalsRaw?.oneOnOne, { fieldKey: "oneOnOne" }) ||
      normalizeText(instinctGoalsRaw?.oneOnOne, { fallback: null }) ||
      FALLBACK_TEXT,
  };

  const developingAsCopy =
    truncateAtFirstHeadingLeak(safe?.developingAsCopy, { fieldKey: "developingAsCopy" }) ||
    normalizeText(safe?.developingAsCopy, { fallback: null }) ||
    FALLBACK_TEXT;
  const developingAsBullets = dedupeRows(safe?.developingAsBullets, MAX_BULLET_ITEMS);
  const bodyLanguageRows = dedupeRows(safe?.bodyLanguageRows, 10);
  const conflictTriggeredBullets = dedupeRows(safe?.conflictTriggeredBullets, MAX_BULLET_ITEMS);

  const normalized = {
    motivationSummary: normalizeText(safe?.motivationSummary, { fallback: null }) || FALLBACK_TEXT,
    instinctGoals,
    developingAsCopy,
    developingAsBullets: developingAsBullets.length ? developingAsBullets : [developingAsCopy],
    bodyLanguageRows: bodyLanguageRows.length ? bodyLanguageRows : [FALLBACK_TEXT],
    conflictResponseCopy: normalizeText(safe?.conflictResponseCopy, { fallback: null }) || FALLBACK_TEXT,
    conflictTriggeredCopy: normalizeText(safe?.conflictTriggeredCopy, { fallback: null }) || FALLBACK_TEXT,
    conflictTriggeredBullets: conflictTriggeredBullets.length ? conflictTriggeredBullets : [FALLBACK_TEXT],
    centeredDecisionCopy: normalizeText(safe?.centeredDecisionCopy, { fallback: null }) || FALLBACK_TEXT,
    decisionImpactCopy: normalizeText(safe?.decisionImpactCopy, { fallback: null }) || FALLBACK_TEXT,
    decisionStrainCopy: normalizeText(safe?.decisionStrainCopy, { fallback: null }) || FALLBACK_TEXT,
    strategicLeadershipCopy: normalizeText(safe?.strategicLeadershipCopy, { fallback: null }) || FALLBACK_TEXT,
    teamImpactCopy: normalizeText(safe?.teamImpactCopy, { fallback: null }) || FALLBACK_TEXT,
    interdependenceCopy: normalizeText(safe?.interdependenceCopy, { fallback: null }) || FALLBACK_TEXT,
    coachingRelationshipCopy: normalizeText(safe?.coachingRelationshipCopy, { fallback: null }) || FALLBACK_TEXT,
  };

  SPREADSHEET_TEXT_KEYS.forEach((key) => {
    if (!normalizeText(normalized[key], { fallback: null })) {
      normalized[key] = FALLBACK_TEXT;
    }
  });
  INSTINCT_FIELDS.forEach((key) => {
    if (!normalizeText(normalized.instinctGoals?.[key], { fallback: null })) {
      normalized.instinctGoals[key] = FALLBACK_TEXT;
    }
  });
  return normalized;
}

function normalizeTeamStageBreakdownInput(value) {
  const safe = value && typeof value === "object" ? value : {};
  return {
    forming: normalizeText(safe?.forming, { fallback: null }) || FALLBACK_TEXT,
    storming: normalizeText(safe?.storming, { fallback: null }) || FALLBACK_TEXT,
    norming: normalizeText(safe?.norming, { fallback: null }) || FALLBACK_TEXT,
    performing: normalizeText(safe?.performing, { fallback: null }) || FALLBACK_TEXT,
  };
}

function normalizeCorePatternBulletsInput(value) {
  const safeRows = Array.isArray(value) ? value : [];
  const byKey = new Map();
  const byLabel = new Map();
  safeRows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const key = normalizeText(row?.key, { fallback: null, maxChars: 80 });
    const label = normalizeText(row?.label, { fallback: null, maxChars: 120 });
    const text = normalizeText(row?.text, { fallback: null });
    if (!text) return;
    if (key) byKey.set(String(key).toLowerCase(), text);
    if (label) byLabel.set(String(label).toLowerCase(), text);
  });
  return CORE_PATTERN_BULLET_DEFINITIONS.map((definition) => {
    const text =
      byKey.get(definition.key) ||
      byLabel.get(String(definition.label).toLowerCase()) ||
      null;
    return {
      key: definition.key,
      label: definition.label,
      text: normalizeText(text, { fallback: null }) || FALLBACK_TEXT,
    };
  });
}

function normalizeCleanupInput(value) {
  const safe = value && typeof value === "object" ? value : {};
  return {
    corePatternBullets: normalizeCorePatternBulletsInput(safe?.corePatternBullets),
    strainQualitativeWriteups: normalizeStrainRowsInput(safe?.strainQualitativeWriteups),
    feedbackGuideMatrix: normalizeFeedbackGuideMatrixInput(safe?.feedbackGuideMatrix),
    overallStrainSummary: normalizeText(safe?.overallStrainSummary, { fallback: null }) || FALLBACK_TEXT,
    developmentExercises: normalizeDevelopmentExercisesInput(safe?.developmentExercises),
    spreadsheetFocuses: normalizeSpreadsheetFocusesInput(safe?.spreadsheetFocuses),
    teamStageBreakdown: normalizeTeamStageBreakdownInput(safe?.teamStageBreakdown),
  };
}

function hasInformativeInput(normalizedPayload) {
  if (!normalizedPayload || typeof normalizedPayload !== "object") return false;
  const rows = [];
  rows.push(...(Array.isArray(normalizedPayload?.corePatternBullets)
    ? normalizedPayload.corePatternBullets.map((row) => row?.text)
    : []));
  rows.push(...(Array.isArray(normalizedPayload?.strainQualitativeWriteups)
    ? normalizedPayload.strainQualitativeWriteups.map((row) => row?.text)
    : []));
  rows.push(...(Array.isArray(normalizedPayload?.feedbackGuideMatrix)
    ? normalizedPayload.feedbackGuideMatrix.map((row) => row?.guidance)
    : []));
  rows.push(...(Array.isArray(normalizedPayload?.developmentExercises)
    ? normalizedPayload.developmentExercises.map((row) => row?.text)
    : []));
  rows.push(normalizedPayload?.overallStrainSummary);
  TEAM_STAGE_KEYS.forEach((key) => rows.push(normalizedPayload?.teamStageBreakdown?.[key]));
  SPREADSHEET_TEXT_KEYS.forEach((key) => rows.push(normalizedPayload?.spreadsheetFocuses?.[key]));
  INSTINCT_FIELDS.forEach((key) => rows.push(normalizedPayload?.spreadsheetFocuses?.instinctGoals?.[key]));
  rows.push(...(Array.isArray(normalizedPayload?.spreadsheetFocuses?.developingAsBullets)
    ? normalizedPayload.spreadsheetFocuses.developingAsBullets
    : []));
  rows.push(...(Array.isArray(normalizedPayload?.spreadsheetFocuses?.bodyLanguageRows)
    ? normalizedPayload.spreadsheetFocuses.bodyLanguageRows
    : []));
  rows.push(...(Array.isArray(normalizedPayload?.spreadsheetFocuses?.conflictTriggeredBullets)
    ? normalizedPayload.spreadsheetFocuses.conflictTriggeredBullets
    : []));
  return rows.some((row) => {
    const text = normalizeText(row, { fallback: null });
    return text && !isMissingText(text);
  });
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

function parseCleanupPayloadFromOpenAiResponse(payload) {
  const firstChoice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const message = firstChoice?.message && typeof firstChoice.message === "object" ? firstChoice.message : null;
  if (message?.parsed && typeof message.parsed === "object") {
    return normalizeCleanupInput(message.parsed);
  }
  const content = extractMessageContent(message);
  const parsed = parseJsonFromContent(content);
  return normalizeCleanupInput(parsed);
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

function buildOpenAiRequestPayload({ payload, detectedType, reportFileName, reportId }) {
  const modelInput = {
    detectedType: normalizeText(detectedType, { fallback: null, maxChars: 40 }),
    reportFileName: normalizeText(reportFileName, { fallback: null, maxChars: 180 }),
    reportId: normalizeText(reportId, { fallback: null, maxChars: 180 }),
    payload,
  };

  return {
    messages: [
      { role: "system", content: DASHBOARD_COPY_CLEANUP_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Clean this dashboard hydration narrative payload:\n${JSON.stringify(modelInput, null, 2)}`,
      },
    ],
    temperature: 0,
    max_completion_tokens: OPENAI_MAX_COMPLETION_TOKENS,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "dashboard_copy_hydration_cleanup",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "corePatternBullets",
            "strainQualitativeWriteups",
            "feedbackGuideMatrix",
            "overallStrainSummary",
            "developmentExercises",
            "spreadsheetFocuses",
            "teamStageBreakdown",
          ],
          properties: {
            corePatternBullets: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "label", "text"],
                properties: {
                  key: { type: "string", enum: CORE_PATTERN_BULLET_DEFINITIONS.map((row) => row.key) },
                  label: { type: "string", enum: CORE_PATTERN_BULLET_DEFINITIONS.map((row) => row.label) },
                  text: { type: "string" },
                },
              },
            },
            strainQualitativeWriteups: {
              type: "array",
              minItems: 6,
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["category", "text"],
                properties: {
                  category: { type: "string", enum: STRAIN_CATEGORIES },
                  text: { type: "string" },
                },
              },
            },
            feedbackGuideMatrix: {
              type: "array",
              minItems: 1,
              maxItems: 9,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["type", "label", "guidance"],
                properties: {
                  type: { type: "string" },
                  label: { type: "string" },
                  guidance: { type: "string" },
                },
              },
            },
            overallStrainSummary: { type: "string" },
            developmentExercises: {
              type: "array",
              minItems: 1,
              maxItems: MAX_EXERCISE_ITEMS,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "text"],
                properties: {
                  title: { type: "string" },
                  text: { type: "string" },
                },
              },
            },
            spreadsheetFocuses: {
              type: "object",
              additionalProperties: false,
              required: [
                "motivationSummary",
                "instinctGoals",
                "developingAsCopy",
                "developingAsBullets",
                "bodyLanguageRows",
                "conflictResponseCopy",
                "conflictTriggeredCopy",
                "conflictTriggeredBullets",
                "centeredDecisionCopy",
                "decisionImpactCopy",
                "decisionStrainCopy",
                "strategicLeadershipCopy",
                "teamImpactCopy",
                "interdependenceCopy",
                "coachingRelationshipCopy",
              ],
              properties: {
                motivationSummary: { type: "string" },
                instinctGoals: {
                  type: "object",
                  additionalProperties: false,
                  required: ["selfPres", "social", "oneOnOne"],
                  properties: {
                    selfPres: { type: "string" },
                    social: { type: "string" },
                    oneOnOne: { type: "string" },
                  },
                },
                developingAsCopy: { type: "string" },
                developingAsBullets: {
                  type: "array",
                  maxItems: MAX_BULLET_ITEMS,
                  items: { type: "string" },
                },
                bodyLanguageRows: {
                  type: "array",
                  maxItems: 10,
                  items: { type: "string" },
                },
                conflictResponseCopy: { type: "string" },
                conflictTriggeredCopy: { type: "string" },
                conflictTriggeredBullets: {
                  type: "array",
                  maxItems: MAX_BULLET_ITEMS,
                  items: { type: "string" },
                },
                centeredDecisionCopy: { type: "string" },
                decisionImpactCopy: { type: "string" },
                decisionStrainCopy: { type: "string" },
                strategicLeadershipCopy: { type: "string" },
                teamImpactCopy: { type: "string" },
                interdependenceCopy: { type: "string" },
                coachingRelationshipCopy: { type: "string" },
              },
            },
            teamStageBreakdown: {
              type: "object",
              additionalProperties: false,
              required: TEAM_STAGE_KEYS,
              properties: {
                forming: { type: "string" },
                storming: { type: "string" },
                norming: { type: "string" },
                performing: { type: "string" },
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
      controller.abort(new Error("dashboard-copy hydration openai request timeout"));
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
          console.log("[dashboard-copy-hydration] Retrying OpenAI cleanup after HTTP failure", {
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
          `Azure OpenAI dashboard-copy cleanup failed (${response.status}): ${String(responseText || "").slice(0, 400)}`,
        );
      }
      const payload = await response.json();
      return payload;
    } catch (error) {
      const retryable = isRetryableFetchError(error);
      const errorClass = classifyRetryableError({ error });
      if (retryable && attemptIndex < maxRetries) {
        const delayMs = computeRetryDelayMs(attemptIndex);
        console.log("[dashboard-copy-hydration] Retrying OpenAI cleanup after transient failure", {
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
      { success: false, error: "Invalid JSON body.", ...normalizeCleanupInput({}) },
      { status: 400 },
    );
  }

  const normalizedInput = normalizeCleanupInput(payload);
  const detectedType = normalizeText(payload?.detectedType, { fallback: null, maxChars: 40 });
  const reportFileName = normalizeText(payload?.reportFileName, { fallback: null, maxChars: 180 });
  const reportId = normalizeText(payload?.reportId, { fallback: null, maxChars: 180 });
  const informativeInput = hasInformativeInput(normalizedInput);

  console.log("[dashboard-copy-hydration] Received LLM cleanup request", {
    reportId,
    reportFileName,
    detectedType,
    informativeInput,
    corePatternRows: normalizedInput.corePatternBullets.length,
    strainRows: normalizedInput.strainQualitativeWriteups.length,
    developmentExercises: normalizedInput.developmentExercises.length,
    feedbackRows: normalizedInput.feedbackGuideMatrix.length,
  });

  if (!informativeInput) {
    return NextResponse.json(
      {
        success: false,
        usedFallback: true,
        reason: "no_informative_sections",
        ...normalizedInput,
      },
      { status: 200 },
    );
  }

  const endpoint = normalizeText(process.env.AZURE_OPENAI_ENDPOINT, { fallback: null, maxChars: 240 });
  const deployment = normalizeText(process.env.AZURE_OPENAI_DEPLOYMENT_NAME, { fallback: null, maxChars: 120 });
  const apiKey = normalizeText(process.env.AZURE_OPENAI_API_KEY, { fallback: null, maxChars: 400 });
  const apiVersion = normalizeText(process.env.AZURE_OPENAI_API_VERSION, { fallback: null, maxChars: 80 }) || "2024-08-01-preview";

  if (!endpoint || !deployment || !apiKey) {
    console.log("[dashboard-copy-hydration] Missing Azure OpenAI env vars; skipping LLM cleanup", {
      hasEndpoint: Boolean(endpoint),
      hasDeployment: Boolean(deployment),
      hasApiKey: Boolean(apiKey),
    });
    return NextResponse.json(
      {
        success: false,
        usedFallback: true,
        reason: "missing_openai_env",
        ...normalizedInput,
      },
      { status: 200 },
    );
  }

  const openAiUrl = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const openAiRequestPayload = buildOpenAiRequestPayload({
    payload: normalizedInput,
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
    const cleanedPayload = parseCleanupPayloadFromOpenAiResponse(openAiPayload);
    const resolvedPayload = normalizeCleanupInput(cleanedPayload);
    console.log("[dashboard-copy-hydration] LLM cleanup completed", {
      reportId,
      reportFileName,
      detectedType,
      model: String(openAiPayload?.model || deployment),
      hasInformativeOutput: hasInformativeInput(resolvedPayload),
    });
    return NextResponse.json(
      {
        success: true,
        usedFallback: false,
        model: String(openAiPayload?.model || deployment),
        provider: `azure-openai:${deployment}`,
        ...resolvedPayload,
      },
      { status: 200 },
    );
  } catch (error) {
    console.log("[dashboard-copy-hydration] LLM cleanup failed; returning deterministic fallback", {
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
        ...normalizedInput,
      },
      { status: 200 },
    );
  }
}
