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
const INSTINCT_FOREIGN_REFERENCE_PATTERNS = Object.freeze({
  selfPres: [
    /One(?:-| )On(?:-| )One\s*-\s*SX/i,
    /Social\s*-\s*SO/i,
    /\bSX\b/,
    /\bSO\b/,
    /sexual\s+instinct/i,
    /one(?:-| )on(?:-| )one\s+instinct/i,
    /one(?:-| )to(?:-| )one\s+instinct/i,
    /social\s+instinct/i,
  ],
  social: [
    /One(?:-| )On(?:-| )One\s*-\s*SX/i,
    /Self(?:-| )Preservation\s*-\s*SP/i,
    /\bSX\b/,
    /\bSP\b/,
    /sexual\s+instinct/i,
    /one(?:-| )on(?:-| )one\s+instinct/i,
    /one(?:-| )to(?:-| )one\s+instinct/i,
    /self(?:-| )preservation\s+instinct/i,
  ],
  oneOnOne: [
    /Social\s*-\s*SO/i,
    /Self(?:-| )Preservation\s*-\s*SP/i,
    /\bSO\b/,
    /\bSP\b/,
    /social\s+instinct/i,
    /self(?:-| )preservation\s+instinct/i,
  ],
});
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
const COPY_CLEANUP_ISSUE_TYPES = [
  "spelling",
  "grammar",
  "truncation",
  "duplication",
  "metadata_leak",
  "style_inconsistency",
  "tone_risk",
  "formatting",
  "other",
];
const COPY_CLEANUP_ISSUE_SEVERITIES = ["low", "medium", "high"];
const COPY_CLEANUP_STATUS_VALUES = ["ok", "needs_review"];
const COPY_CLEANUP_QUALITY_CHECK_KEYS = [
  "noTruncatedWords",
  "noMetadataLeakage",
  "noDuplicates",
  "grammarAndSpellingClean",
  "fieldIsolationPreserved",
  "schemaValid",
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
10. Return a top-level JSON object with exactly two keys:
   - cleanedPayload: the cleaned dashboard payload object.
   - validation: strict validation metadata.
11. validation must include:
   - issues: array of issue objects with type/severity/originalText/cleanedText/note.
   - metadataRemoved: array of removed metadata tokens.
   - qualityChecks: object with booleans for noTruncatedWords, noMetadataLeakage, noDuplicates, grammarAndSpellingClean, fieldIsolationPreserved, schemaValid.
   - status: "ok" or "needs_review" (must be "needs_review" if any qualityChecks value is false).
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

function getInstinctForeignReferencePatterns(fieldKey) {
  const key = String(fieldKey || "").trim();
  return Array.isArray(INSTINCT_FOREIGN_REFERENCE_PATTERNS[key])
    ? INSTINCT_FOREIGN_REFERENCE_PATTERNS[key]
    : [];
}

function hasInstinctForeignReference(text, fieldKey) {
  const normalized = normalizeText(text, { fallback: null });
  if (!normalized) return false;
  const patterns = getInstinctForeignReferencePatterns(fieldKey);
  if (!patterns.length) return false;
  return patterns.some((pattern) => pattern.test(normalized));
}

function findFirstInstinctForeignReferenceIndex(text, fieldKey) {
  const normalized = normalizeText(text, { fallback: null });
  if (!normalized) return -1;
  const patterns = getInstinctForeignReferencePatterns(fieldKey);
  if (!patterns.length) return -1;
  let earliest = -1;
  patterns.forEach((pattern) => {
    const flags = String(pattern.flags || "").replace(/g/g, "");
    const matcher = new RegExp(pattern.source, flags);
    const match = matcher.exec(normalized);
    if (!match) return;
    const index = Number(match.index || 0);
    if (earliest === -1 || index < earliest) earliest = index;
  });
  return earliest;
}

function pruneInstinctGoalFieldText(value, fieldKey) {
  let normalized =
    truncateAtFirstHeadingLeak(value, { fieldKey }) ||
    normalizeText(value, { fallback: null });
  if (!normalized) return null;

  const foreignIndex = findFirstInstinctForeignReferenceIndex(normalized, fieldKey);
  if (foreignIndex > 0) {
    normalized = normalizeText(normalized.slice(0, foreignIndex), { fallback: null });
  }
  if (!normalized) return null;

  const sentenceRows = String(normalized || "")
    .replace(/\s*[•●▪◦·]\s+/g, ". ")
    .split(/(?<=[.?!])\s+/)
    .map((row) => normalizeText(row, { fallback: null }))
    .filter(Boolean);
  if (sentenceRows.length > 1) {
    const filteredRows = sentenceRows.filter((row) => !hasInstinctForeignReference(row, fieldKey));
    if (filteredRows.length && filteredRows.length < sentenceRows.length) {
      normalized = normalizeText(filteredRows.join(" "), { fallback: null });
    } else if (!filteredRows.length) {
      normalized = null;
    }
  }
  return normalized || null;
}

function resolveInstinctGoalFieldGuard({ fieldKey, preferredValue, fallbackValue }) {
  const preferred = pruneInstinctGoalFieldText(preferredValue, fieldKey);
  const fallback = pruneInstinctGoalFieldText(fallbackValue, fieldKey);
  const preferredHasForeign = hasInstinctForeignReference(preferred, fieldKey);
  const fallbackHasForeign = hasInstinctForeignReference(fallback, fieldKey);
  const preferredInformative = preferred && !isMissingText(preferred);
  const fallbackInformative = fallback && !isMissingText(fallback);

  if (preferredInformative && !preferredHasForeign) {
    return {
      value: preferred,
      downRanked: false,
      usedFallback: false,
      reason: null,
    };
  }
  if (fallbackInformative && !fallbackHasForeign) {
    return {
      value: fallback,
      downRanked: Boolean(preferredInformative || preferredHasForeign),
      usedFallback: true,
      reason: preferredHasForeign ? "preferred_foreign_reference" : "preferred_missing",
    };
  }
  if (preferred && !preferredHasForeign && !isMissingText(preferred)) {
    return {
      value: preferred,
      downRanked: false,
      usedFallback: false,
      reason: null,
    };
  }
  if (fallback && !fallbackHasForeign && !isMissingText(fallback)) {
    return {
      value: fallback,
      downRanked: true,
      usedFallback: true,
      reason: "fallback_non_missing",
    };
  }
  return {
    value: FALLBACK_TEXT,
    downRanked: preferredHasForeign || fallbackHasForeign,
    usedFallback: false,
    reason: preferredHasForeign || fallbackHasForeign ? "foreign_reference_unresolved" : "missing_content",
  };
}

function applyInstinctFieldIsolationGuard(cleanedPayload, fallbackPayload = null) {
  const preferredPayload = normalizeCleanupInput(cleanedPayload);
  const fallbackSource = fallbackPayload == null ? preferredPayload : normalizeCleanupInput(fallbackPayload);
  const guardedPayload = normalizeCleanupInput(preferredPayload);
  const downRankedFields = [];

  INSTINCT_FIELDS.forEach((fieldKey) => {
    const guard = resolveInstinctGoalFieldGuard({
      fieldKey,
      preferredValue: preferredPayload?.spreadsheetFocuses?.instinctGoals?.[fieldKey],
      fallbackValue: fallbackSource?.spreadsheetFocuses?.instinctGoals?.[fieldKey],
    });
    guardedPayload.spreadsheetFocuses.instinctGoals[fieldKey] = guard.value || FALLBACK_TEXT;
    if (guard.downRanked) {
      downRankedFields.push({
        fieldKey,
        reason: guard.reason || "guard_applied",
        usedFallback: Boolean(guard.usedFallback),
      });
    }
  });

  return {
    cleanedPayload: guardedPayload,
    downRankedFields,
  };
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

function normalizeIssueType(value) {
  const normalized = String(normalizeText(value, { fallback: "other", maxChars: 80 }) || "other")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .trim();
  if (COPY_CLEANUP_ISSUE_TYPES.includes(normalized)) return normalized;
  return "other";
}

function normalizeIssueSeverity(value) {
  const normalized = String(normalizeText(value, { fallback: "medium", maxChars: 20 }) || "medium")
    .toLowerCase()
    .trim();
  if (COPY_CLEANUP_ISSUE_SEVERITIES.includes(normalized)) return normalized;
  return "medium";
}

function normalizeValidationIssue(value) {
  const safe = value && typeof value === "object" ? value : {};
  const note = normalizeText(safe?.note, { fallback: null, maxChars: 320 });
  return {
    type: normalizeIssueType(safe?.type),
    severity: normalizeIssueSeverity(safe?.severity),
    originalText: normalizeText(safe?.originalText, { fallback: null, maxChars: 320 }) || "Not provided.",
    cleanedText: normalizeText(safe?.cleanedText, { fallback: null, maxChars: 320 }) || "Not provided.",
    note: note || "Issue detected during cleanup validation.",
  };
}

function normalizeValidationStatus(value) {
  const normalized = String(normalizeText(value, { fallback: "", maxChars: 40 }) || "")
    .toLowerCase()
    .trim();
  if (COPY_CLEANUP_STATUS_VALUES.includes(normalized)) return normalized;
  return null;
}

function normalizeValidationMetadataRemoved(value) {
  const safeRows = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  safeRows.forEach((row) => {
    const normalized = normalizeText(row, { fallback: null, maxChars: 120 });
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function normalizeValidationQualityChecks(value) {
  const safe = value && typeof value === "object" ? value : {};
  const out = {};
  COPY_CLEANUP_QUALITY_CHECK_KEYS.forEach((key) => {
    out[key] = typeof safe[key] === "boolean" ? safe[key] : null;
  });
  return out;
}

function collectCleanupTextRows(normalizedPayload) {
  const rows = [];
  if (!normalizedPayload || typeof normalizedPayload !== "object") return rows;

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

  return rows
    .map((row) => normalizeText(row, { fallback: null }))
    .filter(Boolean);
}

function looksLikeMetadataLeak(text) {
  const normalized = normalizeText(text, { fallback: null });
  if (!normalized) return false;
  if (/\|/.test(normalized)) return true;
  if (/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(normalized) && /\b\d{4}\b/.test(normalized)) {
    return true;
  }
  if (/\b(?:english|french|spanish|german|italian|portuguese)\b/i.test(normalized) && /\b\d{4}\b/.test(normalized)) {
    return true;
  }
  return false;
}

function looksLikeTruncatedLine(text) {
  const normalized = normalizeText(text, { fallback: null });
  if (!normalized) return false;
  if (/[a-z]{2,}\.\.\.$/i.test(normalized)) return true;
  if (/\b(?:impa|mistak|decisins)\b/i.test(normalized)) return true;
  return false;
}

function detectDuplicateRows(rows) {
  const duplicates = [];
  const seen = new Set();
  rows.forEach((row) => {
    const normalized = normalizeText(row, { fallback: null });
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(normalized);
      return;
    }
    seen.add(key);
  });
  return duplicates;
}

function detectInstinctFieldIsolationIssues(normalizedPayload) {
  const issues = [];
  const selfPres = normalizeText(normalizedPayload?.spreadsheetFocuses?.instinctGoals?.selfPres, { fallback: "" }) || "";
  const social = normalizeText(normalizedPayload?.spreadsheetFocuses?.instinctGoals?.social, { fallback: "" }) || "";
  const oneOnOne = normalizeText(normalizedPayload?.spreadsheetFocuses?.instinctGoals?.oneOnOne, { fallback: "" }) || "";

  if (hasInstinctForeignReference(social, "social")) {
    issues.push("Social field contains non-social instinct heading spillover.");
  }
  if (hasInstinctForeignReference(oneOnOne, "oneOnOne")) {
    issues.push("One-On-One field contains non-SX instinct heading spillover.");
  }
  if (hasInstinctForeignReference(selfPres, "selfPres")) {
    issues.push("Self-Preservation field contains non-SP instinct heading spillover.");
  }
  return issues;
}

function buildDeterministicValidationResult(cleanedPayload, modelValidation = null) {
  const normalizedPayload = normalizeCleanupInput(cleanedPayload);
  const candidateValidation = modelValidation && typeof modelValidation === "object" ? modelValidation : {};
  const rows = collectCleanupTextRows(normalizedPayload);
  const duplicateRows = detectDuplicateRows(rows);
  const metadataLeakRows = rows.filter((row) => looksLikeMetadataLeak(row));
  const truncatedRows = rows.filter((row) => looksLikeTruncatedLine(row));
  const isolationIssues = detectInstinctFieldIsolationIssues(normalizedPayload);

  const qualityChecks = normalizeValidationQualityChecks(candidateValidation?.qualityChecks);
  const resolvedQualityChecks = {
    noTruncatedWords:
      typeof qualityChecks.noTruncatedWords === "boolean"
        ? qualityChecks.noTruncatedWords
        : truncatedRows.length === 0,
    noMetadataLeakage:
      typeof qualityChecks.noMetadataLeakage === "boolean"
        ? qualityChecks.noMetadataLeakage
        : metadataLeakRows.length === 0,
    noDuplicates:
      typeof qualityChecks.noDuplicates === "boolean"
        ? qualityChecks.noDuplicates
        : duplicateRows.length === 0,
    grammarAndSpellingClean:
      typeof qualityChecks.grammarAndSpellingClean === "boolean"
        ? qualityChecks.grammarAndSpellingClean
        : truncatedRows.length === 0,
    fieldIsolationPreserved:
      typeof qualityChecks.fieldIsolationPreserved === "boolean"
        ? qualityChecks.fieldIsolationPreserved
        : isolationIssues.length === 0,
    schemaValid:
      typeof qualityChecks.schemaValid === "boolean"
        ? qualityChecks.schemaValid
        : true,
  };

  const issues = Array.isArray(candidateValidation?.issues)
    ? candidateValidation.issues.map((issue) => normalizeValidationIssue(issue)).slice(0, 24)
    : [];
  if (truncatedRows.length) {
    issues.push(
      normalizeValidationIssue({
        type: "truncation",
        severity: "high",
        originalText: truncatedRows[0],
        cleanedText: truncatedRows[0],
        note: "Detected likely truncated text artifact after cleanup.",
      }),
    );
  }
  if (metadataLeakRows.length) {
    issues.push(
      normalizeValidationIssue({
        type: "metadata_leak",
        severity: "high",
        originalText: metadataLeakRows[0],
        cleanedText: "",
        note: "Detected likely metadata leakage in narrative output.",
      }),
    );
  }
  if (duplicateRows.length) {
    issues.push(
      normalizeValidationIssue({
        type: "duplication",
        severity: "medium",
        originalText: duplicateRows[0],
        cleanedText: duplicateRows[0],
        note: "Detected duplicate narrative row in cleaned payload.",
      }),
    );
  }
  if (isolationIssues.length) {
    issues.push(
      normalizeValidationIssue({
        type: "style_inconsistency",
        severity: "high",
        originalText: isolationIssues[0],
        cleanedText: isolationIssues[0],
        note: "Detected instinct field isolation spillover.",
      }),
    );
  }

  const metadataRemoved = normalizeValidationMetadataRemoved(candidateValidation?.metadataRemoved);
  const statusFromModel = normalizeValidationStatus(candidateValidation?.status);
  const hasFailedCheck = Object.values(resolvedQualityChecks).some((value) => value === false);
  const status = hasFailedCheck ? "needs_review" : (statusFromModel || "ok");

  return {
    issues,
    metadataRemoved,
    qualityChecks: resolvedQualityChecks,
    status,
  };
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

function resolveCleanupEnvelope(value) {
  const safe = value && typeof value === "object" ? value : {};
  const cleanedPayload = normalizeCleanupInput(
    safe?.cleanedPayload && typeof safe.cleanedPayload === "object"
      ? safe.cleanedPayload
      : safe,
  );
  const copyCleanupValidation = buildDeterministicValidationResult(cleanedPayload, safe?.validation);
  return { cleanedPayload, copyCleanupValidation };
}

function parseCleanupPayloadFromOpenAiResponse(payload) {
  const firstChoice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const message = firstChoice?.message && typeof firstChoice.message === "object" ? firstChoice.message : null;
  if (message?.parsed && typeof message.parsed === "object") {
    return resolveCleanupEnvelope({
      cleanedPayload: message?.parsed?.cleanedPayload ?? message.parsed,
      validation: message?.parsed?.validation,
    });
  }
  const content = extractMessageContent(message);
  const parsed = parseJsonFromContent(content);
  return resolveCleanupEnvelope(parsed);
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

function buildCleanedPayloadJsonSchema() {
  return {
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
  };
}

function buildValidationJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["issues", "metadataRemoved", "qualityChecks", "status"],
    properties: {
      issues: {
        type: "array",
        maxItems: 24,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "severity", "originalText", "cleanedText", "note"],
          properties: {
            type: { type: "string", enum: COPY_CLEANUP_ISSUE_TYPES },
            severity: { type: "string", enum: COPY_CLEANUP_ISSUE_SEVERITIES },
            originalText: { type: "string" },
            cleanedText: { type: "string" },
            note: { type: "string" },
          },
        },
      },
      metadataRemoved: {
        type: "array",
        maxItems: 24,
        items: { type: "string" },
      },
      qualityChecks: {
        type: "object",
        additionalProperties: false,
        required: COPY_CLEANUP_QUALITY_CHECK_KEYS,
        properties: {
          noTruncatedWords: { type: "boolean" },
          noMetadataLeakage: { type: "boolean" },
          noDuplicates: { type: "boolean" },
          grammarAndSpellingClean: { type: "boolean" },
          fieldIsolationPreserved: { type: "boolean" },
          schemaValid: { type: "boolean" },
        },
      },
      status: { type: "string", enum: COPY_CLEANUP_STATUS_VALUES },
    },
  };
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
        name: "dashboard_copy_hydration_cleanup_strict",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["cleanedPayload", "validation"],
          properties: {
            cleanedPayload: buildCleanedPayloadJsonSchema(),
            validation: buildValidationJsonSchema(),
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
    const fallbackPayload = normalizeCleanupInput({});
    const fallbackGuard = applyInstinctFieldIsolationGuard(fallbackPayload, fallbackPayload);
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON body.",
        copyCleanupValidation: buildDeterministicValidationResult(fallbackGuard.cleanedPayload),
        instinctFieldGuard: {
          downRankedFields: fallbackGuard.downRankedFields,
        },
        ...fallbackGuard.cleanedPayload,
      },
      { status: 400 },
    );
  }

  const normalizedInput = normalizeCleanupInput(payload);
  const inputGuardResult = applyInstinctFieldIsolationGuard(normalizedInput, normalizedInput);
  const guardedInputPayload = inputGuardResult.cleanedPayload;
  const deterministicValidation = buildDeterministicValidationResult(guardedInputPayload);
  const detectedType = normalizeText(payload?.detectedType, { fallback: null, maxChars: 40 });
  const reportFileName = normalizeText(payload?.reportFileName, { fallback: null, maxChars: 180 });
  const reportId = normalizeText(payload?.reportId, { fallback: null, maxChars: 180 });
  const informativeInput = hasInformativeInput(guardedInputPayload);

  console.log("[dashboard-copy-hydration] Received LLM cleanup request", {
    reportId,
    reportFileName,
    detectedType,
    informativeInput,
    corePatternRows: guardedInputPayload.corePatternBullets.length,
    strainRows: guardedInputPayload.strainQualitativeWriteups.length,
    developmentExercises: guardedInputPayload.developmentExercises.length,
    feedbackRows: guardedInputPayload.feedbackGuideMatrix.length,
    downRankedInstinctFields: inputGuardResult.downRankedFields.length,
  });

  if (!informativeInput) {
    return NextResponse.json(
      {
        success: false,
        usedFallback: true,
        reason: "no_informative_sections",
        copyCleanupValidation: deterministicValidation,
        instinctFieldGuard: {
          downRankedFields: inputGuardResult.downRankedFields,
        },
        ...guardedInputPayload,
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
        copyCleanupValidation: deterministicValidation,
        instinctFieldGuard: {
          downRankedFields: inputGuardResult.downRankedFields,
        },
        ...guardedInputPayload,
      },
      { status: 200 },
    );
  }

  const openAiUrl = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const openAiRequestPayload = buildOpenAiRequestPayload({
    payload: guardedInputPayload,
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
    const cleanedResult = parseCleanupPayloadFromOpenAiResponse(openAiPayload);
    const resolvedPayload = normalizeCleanupInput(cleanedResult?.cleanedPayload);
    const outputGuardResult = applyInstinctFieldIsolationGuard(resolvedPayload, guardedInputPayload);
    const guardedOutputPayload = outputGuardResult.cleanedPayload;
    const copyCleanupValidation = buildDeterministicValidationResult(
      guardedOutputPayload,
      cleanedResult?.copyCleanupValidation && typeof cleanedResult.copyCleanupValidation === "object"
        ? cleanedResult.copyCleanupValidation
        : null,
    );
    console.log("[dashboard-copy-hydration] LLM cleanup completed", {
      reportId,
      reportFileName,
      detectedType,
      model: String(openAiPayload?.model || deployment),
      hasInformativeOutput: hasInformativeInput(guardedOutputPayload),
      downRankedInstinctFields: outputGuardResult.downRankedFields.length,
      validationStatus: copyCleanupValidation?.status,
      validationIssues: Array.isArray(copyCleanupValidation?.issues)
        ? copyCleanupValidation.issues.length
        : 0,
    });
    return NextResponse.json(
      {
        success: true,
        usedFallback: false,
        model: String(openAiPayload?.model || deployment),
        provider: `azure-openai:${deployment}`,
        copyCleanupValidation,
        instinctFieldGuard: {
          downRankedFields: outputGuardResult.downRankedFields,
        },
        ...guardedOutputPayload,
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
        copyCleanupValidation: deterministicValidation,
        instinctFieldGuard: {
          downRankedFields: inputGuardResult.downRankedFields,
        },
        ...guardedInputPayload,
      },
      { status: 200 },
    );
  }
}
