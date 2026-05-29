import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  TARGETED_DEVELOPMENT_CONTEXT_PAGE_MAP,
  TARGETED_FOOTER_PATTERN,
  TARGETED_SECTION_HEADER_TITLES,
  TARGETED_SECTION_PAGE_MAP,
  ieq9_targeted_sections_schema,
} from "./ieq9TargetedExtractionConfig.js";

const execFileAsync = promisify(execFile);
const LOCAL_FALLBACK_PARSER_VERSION = "local-pypdf-fallback-v1";
const LOCAL_PYTHON_MAX_BUFFER_BYTES = 24 * 1024 * 1024;

// =====================================================================
// 1. STRICT JSON SCHEMA (Expanded for Semantic Targeting)
// =====================================================================
const enneagram_report_schema = {
  type: "object",
  properties: {
    clientName: { type: ["string", "null"] },
    reportDate: { type: ["string", "null"] },
    primaryType: { type: ["integer", "null"] },
    typeName: { type: ["string", "null"] },
    wing: { type: ["integer", "null"] },
    instinctualVariant: { type: ["string", "null"], enum: ["sx", "so", "sp", null] },
    levelOfDevelopment: { type: ["integer", "null"] },
    integrationLevel: { type: ["string", "null"] },
    subtypeKeyword: { type: ["string", "null"] },
    worldview: { type: ["string", "null"] },
    focusOfAttention: { type: ["string", "null"] },
    coreFear: { type: ["string", "null"] },
    coreDesire: { type: ["string", "null"] },
    selfTalk: { type: ["string", "null"] },
    passion: { type: ["string", "null"] },
    reportSummary: { type: ["string", "null"] },
    metaMessage: { type: ["string", "null"] },
    connectedLineA: { type: ["string", "null"] },
    connectedLineB: { type: ["string", "null"] },
    centreOfIntelligence: { type: ["string", "null"] },
    
    // FIX: Changed container types from ["array", "null"] to strictly "array"
    developmentExercises: { 
      type: "array", 
      items: { type: "string" } 
    },
    // FIX: Changed container types from ["object", "null"] to strictly "object"
    centerLabels: {
      type: "object",
      properties: {
        action: { type: ["string", "null"] },
        feeling: { type: ["string", "null"] },
        thinking: { type: ["string", "null"] }
      },
      required: ["action", "feeling", "thinking"],
      additionalProperties: false
    },
    strainNarratives: {
      type: "object",
      properties: {
        happiness: { type: ["string", "null"] },
        vocational: { type: ["string", "null"] },
        interpersonal: { type: ["string", "null"] },
        physical: { type: ["string", "null"] },
        environmental: { type: ["string", "null"] },
        psychological: { type: ["string", "null"] }
      },
      required: ["happiness", "vocational", "interpersonal", "physical", "environmental", "psychological"],
      additionalProperties: false
    },
    
    // NEW: Fully Strict-Mode Compliant reportContent & proSections block
    reportContent: {
      type: "object",
      properties: {
        documentSummary: { type: ["string", "null"] },
        developmentExercisesText: { type: ["string", "null"] },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sectionId: { type: ["string", "null"] },
              sectionTitle: { type: ["string", "null"] },
              pageStart: { type: ["integer", "null"] },
              pageEnd: { type: ["integer", "null"] },
              summary: { type: ["string", "null"] },
              fullText: { type: ["string", "null"] }
            },
            required: ["sectionId", "sectionTitle", "pageStart", "pageEnd", "summary", "fullText"],
            additionalProperties: false
          }
        },
        proSections: {
          type: "object",
          properties: {
            team_dynamics: { type: "object", properties: { summary: { type: ["string", "null"] }, fullText: { type: ["string", "null"] }, pageStart: { type: ["integer", "null"] }, pageEnd: { type: ["integer", "null"] }, sectionTitle: { type: ["string", "null"] } }, required: ["summary", "fullText", "pageStart", "pageEnd", "sectionTitle"], additionalProperties: false },
            feedback_matrix: { type: "object", properties: { summary: { type: ["string", "null"] }, fullText: { type: ["string", "null"] }, pageStart: { type: ["integer", "null"] }, pageEnd: { type: ["integer", "null"] }, sectionTitle: { type: ["string", "null"] } }, required: ["summary", "fullText", "pageStart", "pageEnd", "sectionTitle"], additionalProperties: false },
            decision_framework: { type: "object", properties: { summary: { type: ["string", "null"] }, fullText: { type: ["string", "null"] }, pageStart: { type: ["integer", "null"] }, pageEnd: { type: ["integer", "null"] }, sectionTitle: { type: ["string", "null"] } }, required: ["summary", "fullText", "pageStart", "pageEnd", "sectionTitle"], additionalProperties: false },
            strategic_leadership: { type: "object", properties: { summary: { type: ["string", "null"] }, fullText: { type: ["string", "null"] }, pageStart: { type: ["integer", "null"] }, pageEnd: { type: ["integer", "null"] }, sectionTitle: { type: ["string", "null"] } }, required: ["summary", "fullText", "pageStart", "pageEnd", "sectionTitle"], additionalProperties: false },
            coaching_relationship: { type: "object", properties: { summary: { type: ["string", "null"] }, fullText: { type: ["string", "null"] }, pageStart: { type: ["integer", "null"] }, pageEnd: { type: ["integer", "null"] }, sectionTitle: { type: ["string", "null"] } }, required: ["summary", "fullText", "pageStart", "pageEnd", "sectionTitle"], additionalProperties: false }
          },
          required: ["team_dynamics", "feedback_matrix", "decision_framework", "strategic_leadership", "coaching_relationship"],
          additionalProperties: false
        }
      },
      required: ["documentSummary", "developmentExercisesText", "sections", "proSections"],
      additionalProperties: false
    }
  },
  required: [
    "clientName", "reportDate", "primaryType", "typeName", "wing",
    "instinctualVariant", "levelOfDevelopment", "integrationLevel",
    "subtypeKeyword", "worldview", "focusOfAttention", "coreFear",
    "coreDesire", "selfTalk", "passion", "reportSummary", "metaMessage",
    "connectedLineA", "connectedLineB", "centreOfIntelligence",
    "developmentExercises", "centerLabels", "strainNarratives", "reportContent"
  ],
  additionalProperties: false
};

function normalizeWhitespace(value) {
  return String(value || "").replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
}

function collectMappedPageNumbers(mapping) {
  const unique = new Set();
  if (!mapping || typeof mapping !== "object") return [];
  for (const pages of Object.values(mapping)) {
    for (const pageNumber of Array.isArray(pages) ? pages : []) {
      const numeric = Number(pageNumber);
      if (Number.isFinite(numeric) && numeric > 0) unique.add(Math.floor(numeric));
    }
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function getBoundingRegionPageNumbers(item) {
  const regions = Array.isArray(item?.boundingRegions) ? item.boundingRegions : [];
  const pages = new Set();
  for (const region of regions) {
    const numeric = Number(region?.pageNumber);
    if (Number.isFinite(numeric) && numeric > 0) pages.add(Math.floor(numeric));
  }
  return pages;
}

function polygonToPoints(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return [];
  if (typeof polygon[0] === "number") {
    const points = [];
    for (let idx = 0; idx < polygon.length - 1; idx += 2) {
      const x = Number(polygon[idx]);
      const y = Number(polygon[idx + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
    }
    return points;
  }
  return polygon
    .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function getPolygonBounds(polygon) {
  const points = polygonToPoints(polygon);
  if (!points.length) return null;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points.slice(1)) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, maxX, minY, maxY };
}

function splitAdiLinesIntoColumns(lines, pageWidth) {
  if (!Array.isArray(lines) || lines.length < 18) return [Array.isArray(lines) ? lines : []];
  const width = Number(pageWidth);
  if (!Number.isFinite(width) || width <= 0) return [lines];
  const candidates = [width * 0.45, width * 0.5, width * 0.55];
  for (const splitX of candidates) {
    const left = lines.filter((line) => ((line.x0 + line.x1) / 2) < splitX);
    const right = lines.filter((line) => ((line.x0 + line.x1) / 2) >= splitX);
    if (left.length < 8 || right.length < 8) continue;
    const leftMaxX = Math.max(...left.map((line) => line.x1));
    const rightMinX = Math.min(...right.map((line) => line.x0));
    if (rightMinX - leftMaxX >= width * 0.04) return [left, right];
  }
  return [lines];
}

function buildLayoutAwarePageText({ page, paragraphs }) {
  const pageNumber = Number(page?.pageNumber);
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) return "";

  const lines = Array.isArray(page?.lines) ? page.lines : [];
  const normalizedLines = lines
    .map((line) => {
      const content = normalizeWhitespace(line?.content || "");
      if (!content) return null;
      const bounds = getPolygonBounds(line?.polygon);
      if (!bounds) return null;
      return {
        content,
        x0: bounds.minX,
        x1: bounds.maxX,
        y0: bounds.minY,
      };
    })
    .filter(Boolean);

  if (normalizedLines.length) {
    const columns = splitAdiLinesIntoColumns(normalizedLines, Number(page?.width));
    const columnText = columns
      .map((column) =>
        column
          .slice()
          .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0))
          .map((line) => line.content)
          .join("\n")
          .trim(),
      )
      .filter(Boolean);
    if (columnText.length) return columnText.join("\n\n").trim();
  }

  return (Array.isArray(paragraphs) ? paragraphs : [])
    .filter((paragraph) => {
      if (!paragraph || ["pageHeader", "pageFooter", "pageNumber"].includes(paragraph?.role)) return false;
      const pageNumbers = getBoundingRegionPageNumbers(paragraph);
      return pageNumbers.has(pageNumber);
    })
    .map((paragraph) => normalizeWhitespace(paragraph?.content || ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildLayoutAwarePageTextLookup({ pages, paragraphs }) {
  const lookup = {};
  for (const page of Array.isArray(pages) ? pages : []) {
    const pageNumber = Number(page?.pageNumber);
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) continue;
    const text = buildLayoutAwarePageText({ page, paragraphs });
    if (text) lookup[pageNumber] = text;
  }
  return lookup;
}

function stripTargetedFooterNoise(text) {
  return String(text || "").replace(TARGETED_FOOTER_PATTERN, " ").trim();
}

function anchorSectionBodyFromHeader(sectionName, text) {
  const source = String(text || "").trim();
  if (!source) return "";
  const headers = Array.isArray(TARGETED_SECTION_HEADER_TITLES?.[sectionName])
    ? TARGETED_SECTION_HEADER_TITLES[sectionName]
    : [];
  const sourceLower = source.toLowerCase();
  for (const header of headers) {
    const lowerHeader = String(header || "").toLowerCase().trim();
    if (!lowerHeader) continue;
    const index = sourceLower.indexOf(lowerHeader);
    if (index === -1) continue;
    const anchored = source.slice(index + header.length).trim();
    if (anchored) return anchored;
  }
  return source;
}

function buildTargetedSectionTextByName(pageTextByNumber) {
  const cleaned = {};
  const pageEntries = Object.entries(pageTextByNumber || {})
    .map(([pageNumber, text]) => [Number(pageNumber), String(text || "").trim()])
    .filter(([pageNumber, text]) => Number.isFinite(pageNumber) && pageNumber > 0 && text);
  const findDynamicCandidates = (sectionName, mappedPagesSet) => {
    const headerHints = Array.isArray(TARGETED_SECTION_HEADER_TITLES?.[sectionName])
      ? TARGETED_SECTION_HEADER_TITLES[sectionName]
      : [];
    const aliasHints = {
      strain_interpretation: ["strain profile", "strain area breakdown", "overall strain level"],
      body_language: ["body language", "communication style"],
      feedback_guide: ["feedback guide", "giving feedback", "all 9 types"],
      decision_framework: ["decision making", "centered decisions", "receiving decisions"],
      strategic_leadership: ["strategic leadership", "visioning", "change management", "alignment"],
      team_dynamics: ["team behaviour", "team stages", "forming", "storming", "norming", "performing"],
      coaching_relationship: ["coaching relationship", "coaching"],
      development_exercises: ["development exercise", "development exercises", "exercise library", "growth path"],
    };
    const hints = [...headerHints, ...(aliasHints[sectionName] || [])]
      .map((value) => String(value || "").toLowerCase().trim())
      .filter(Boolean);
    if (!hints.length) return [];
    return pageEntries
      .filter(([pageNumber, text]) => {
        if (mappedPagesSet.has(pageNumber)) return false;
        const lower = text.toLowerCase();
        return hints.some((hint) => lower.includes(hint));
      })
      .map(([pageNumber, text]) => [pageNumber, text]);
  };
  for (const [sectionName, pageNumbers] of Object.entries(TARGETED_SECTION_PAGE_MAP)) {
    const chunks = [];
    const mappedPagesSet = new Set((Array.isArray(pageNumbers) ? pageNumbers : []).map((value) => Number(value)));
    for (const pageNumber of pageNumbers) {
      const raw = String(pageTextByNumber?.[pageNumber] || "").trim();
      if (!raw) continue;
      const withoutFooter = stripTargetedFooterNoise(raw);
      if (!withoutFooter) continue;
      chunks.push(`[Page ${pageNumber}] ${withoutFooter}`);
    }
    const mappedJoined = chunks.join("\n\n").trim();
    if (mappedJoined.length < 320) {
      const dynamicCandidates = findDynamicCandidates(sectionName, mappedPagesSet)
        .slice(0, 8);
      for (const [pageNumber, text] of dynamicCandidates) {
        const withoutFooter = stripTargetedFooterNoise(text);
        if (!withoutFooter) continue;
        chunks.push(`[Page ${pageNumber}] ${withoutFooter}`);
      }
    }
    cleaned[sectionName] = anchorSectionBodyFromHeader(sectionName, chunks.join("\n\n").trim());
  }
  return cleaned;
}

function buildTargetedDevelopmentContextTextByName(pageTextByNumber) {
  const context = {};
  for (const [contextName, pageNumbers] of Object.entries(TARGETED_DEVELOPMENT_CONTEXT_PAGE_MAP)) {
    const chunks = [];
    for (const pageNumber of pageNumbers) {
      const raw = String(pageTextByNumber?.[pageNumber] || "").trim();
      if (!raw) continue;
      const withoutFooter = stripTargetedFooterNoise(raw);
      if (!withoutFooter) continue;
      chunks.push(`[Page ${pageNumber}] ${withoutFooter}`);
    }
    context[contextName] = anchorSectionBodyFromHeader("development_exercises", chunks.join("\n\n").trim());
  }
  return context;
}

function formatStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function compactSectionTextLines(lines) {
  return lines
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function computeTargetedCriticalSectionCoverage(parsedData, targetedSectionEntries) {
  const hasGuidanceRows = Array.isArray(parsedData?.feedbackGuideMatrix)
    ? parsedData.feedbackGuideMatrix.filter((row) => normalizeWhitespace(row?.guidance || "")).length
    : 0;
  const team = parsedData?.teamStageBreakdown && typeof parsedData.teamStageBreakdown === "object"
    ? parsedData.teamStageBreakdown
    : {};
  const teamFields = ["forming", "storming", "norming", "performing"];
  const teamCount = teamFields.filter((key) => normalizeWhitespace(team?.[key] || "")).length;
  const coachingText = normalizeWhitespace(
    Array.isArray(parsedData?.coachingRelationship)
      ? parsedData.coachingRelationship.join(" ")
      : parsedData?.coachingRelationship || "",
  );
  const devRows = Array.isArray(parsedData?.developmentExercises)
    ? parsedData.developmentExercises
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean)
    : [];
  const devRowsWithoutDefault = devRows.filter((value) => !/physical pause before reacting/i.test(value));
  const sectionEntryMap = new Map(
    (Array.isArray(targetedSectionEntries) ? targetedSectionEntries : [])
      .map((entry) => [String(entry?.sectionId || ""), normalizeWhitespace(entry?.fullText || entry?.summary || "")]),
  );
  const sectionEntryHasContent = (sectionId) => sectionEntryMap.get(sectionId) && sectionEntryMap.get(sectionId).length >= 40;
  const required = {
    feedback_guide: hasGuidanceRows >= 6 || sectionEntryHasContent("feedback_guide"),
    decision_framework: sectionEntryHasContent("decision_framework"),
    strategic_leadership: sectionEntryHasContent("strategic_leadership"),
    team_dynamics: teamCount >= 3 || sectionEntryHasContent("team_dynamics"),
    coaching_relationship: coachingText.length >= 40 || sectionEntryHasContent("coaching_relationship"),
    development_exercises: devRowsWithoutDefault.length >= 3 || sectionEntryHasContent("development_exercises"),
  };
  const total = Object.keys(required).length;
  const hydrated = Object.values(required).filter(Boolean).length;
  return {
    required,
    hydrated,
    total,
    isComplete: hydrated === total,
  };
}

function getSectionPageRange(sectionId) {
  const mapped = Array.isArray(TARGETED_SECTION_PAGE_MAP?.[sectionId]) ? TARGETED_SECTION_PAGE_MAP[sectionId] : [];
  if (!mapped.length) return { pageStart: null, pageEnd: null };
  return { pageStart: mapped[0], pageEnd: mapped[mapped.length - 1] };
}

function mergeSectionEntries(baseSections, incomingSections) {
  const merged = [];
  const seen = new Map();
  const upsert = (section) => {
    const entry = section && typeof section === "object" ? section : null;
    if (!entry) return;
    const idKey = String(entry?.sectionId || entry?.sectionTitle || "").trim().toLowerCase();
    const key = idKey || `index:${merged.length}`;
    const existingIndex = seen.get(key);
    if (existingIndex == null) {
      seen.set(key, merged.length);
      merged.push(entry);
      return;
    }
    const existing = merged[existingIndex] || {};
    const preferIncomingText = String(entry?.fullText || "").trim().length >= String(existing?.fullText || "").trim().length;
    merged[existingIndex] = {
      ...existing,
      ...entry,
      fullText: preferIncomingText ? entry.fullText : existing.fullText,
      summary: String(entry?.summary || "").trim() ? entry.summary : existing.summary,
      sectionTitle: entry.sectionTitle || existing.sectionTitle,
      sectionId: entry.sectionId || existing.sectionId,
      pageStart: Number.isFinite(Number(entry?.pageStart)) ? Number(entry.pageStart) : existing.pageStart,
      pageEnd: Number.isFinite(Number(entry?.pageEnd)) ? Number(entry.pageEnd) : existing.pageEnd,
    };
  };
  for (const section of Array.isArray(baseSections) ? baseSections : []) upsert(section);
  for (const section of Array.isArray(incomingSections) ? incomingSections : []) upsert(section);
  return merged;
}

async function extractTargetedSectionsWithAzureOpenAi({
  openAiUrl,
  apiKey,
  cleanedSections,
  developmentContext,
}) {
  const payload = JSON.stringify({
    instructions: {
      rules: [
        "Return valid JSON only.",
        "Match the schema exactly.",
        "Do not invent missing facts.",
        "Use empty strings or empty arrays when no evidence exists.",
        "Respect section boundaries and source pages.",
      ],
    },
    sections: cleanedSections,
    development_exercise_context: developmentContext,
  });

  const response = await fetch(openAiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content:
            "You transform extracted iEQ9 report text into strict structured JSON. Never include markdown or prose.",
        },
        { role: "user", content: payload },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ieq9_targeted_sections_schema",
          strict: true,
          schema: ieq9_targeted_sections_schema,
        },
      },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`Azure OpenAI targeted section extraction error: ${await response.text()}`);
  }

  const aiData = await response.json();
  return JSON.parse(aiData?.choices?.[0]?.message?.content || "{}");
}

function normalizeLevelLabel(level) {
  const normalized = String(level || "").trim().toUpperCase();
  if (normalized === "HIGH") return "High";
  if (normalized === "MEDIUM" || normalized === "MODERATE") return "Medium";
  if (normalized === "LOW") return "Low";
  return null;
}

function scoreToLevelLabel(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 67) return "High";
  if (numeric >= 34) return "Medium";
  return "Low";
}

function levelLabelToVisualScore(level) {
  const normalized = normalizeLevelLabel(level);
  if (normalized === "High") return 80;
  if (normalized === "Medium") return 55;
  if (normalized === "Low") return 25;
  return null;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexibleWordPattern(word) {
  return String(word || "")
    .split("")
    .map((char) => (/[A-Za-z0-9]/.test(char) ? `${escapeRegex(char)}\\s*` : escapeRegex(char)))
    .join("");
}

function buildFlexiblePhrasePattern(phrase) {
  return String(phrase || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => buildFlexibleWordPattern(word))
    .join("\\s*");
}

const FLEX_LEVEL_TOKEN_PATTERN =
  "((?:L\\s*O\\s*W)|(?:M\\s*E\\s*D\\s*I\\s*U\\s*M)|(?:H\\s*I\\s*G\\s*H)|(?:M\\s*O\\s*D\\s*E\\s*R\\s*A\\s*T\\s*E(?:\\s*L\\s*Y)?)|(?:H\\s*I\\s*G\\s*H\\s*L\\s*Y)|(?:L\\s*O\\s*W\\s*L\\s*Y))";

function normalizeMatchedLevelToken(level) {
  const normalized = String(level || "").replace(/[^A-Za-z]/g, "").trim().toUpperCase();
  if (normalized === "HIGH" || normalized === "HIGHLY") return "High";
  if (normalized === "MEDIUM" || normalized === "MODERATE" || normalized === "MODERATELY") return "Medium";
  if (normalized === "LOW" || normalized === "LOWLY") return "Low";
  return null;
}

function extractQualitativeLevelFromText(text, labels) {
  const source = String(text || "").replace(/\u0000/g, " ");
  const safeLabels = Array.isArray(labels) ? labels : [];
  for (const label of safeLabels) {
    const exactLabel = escapeRegex(label);
    const exactMatch = source.match(new RegExp(`${exactLabel}[\\s\\S]{0,72}?${FLEX_LEVEL_TOKEN_PATTERN}`, "i"));
    const exactLevel = normalizeMatchedLevelToken(exactMatch?.[1]);
    if (exactLevel) return exactLevel;

    const flexibleLabel = buildFlexiblePhrasePattern(label);
    if (!flexibleLabel) continue;
    const fuzzyMatch = source.match(new RegExp(`${flexibleLabel}[\\s\\S]{0,72}?${FLEX_LEVEL_TOKEN_PATTERN}`, "i"));
    const fuzzyLevel = normalizeMatchedLevelToken(fuzzyMatch?.[1]);
    if (fuzzyLevel) return fuzzyLevel;

    const expressionMatch = source.match(
      new RegExp(
        `${flexibleLabel}[\\s\\S]{0,42}?\\b(?:is\\s+)?${FLEX_LEVEL_TOKEN_PATTERN}[\\s\\S]{0,28}?\\b(?:expressed|expression)\\b`,
        "i",
      ),
    );
    const expressionLevel = normalizeMatchedLevelToken(expressionMatch?.[1]);
    if (expressionLevel) return expressionLevel;
  }
  return null;
}

function extractNumericScoreFromText(text, labels) {
  const source = String(text || "").replace(/\u0000/g, " ");
  const safeLabels = Array.isArray(labels) ? labels : [];
  for (const label of safeLabels) {
    const exactLabel = escapeRegex(label);
    const exactMatch = source.match(new RegExp(`${exactLabel}\\s*(?:\\||:|-|\\s)\\s*(\\d{1,2})\\b`, "i"));
    if (exactMatch?.[1]) return Number.parseInt(exactMatch[1], 10);

    const flexibleLabel = buildFlexiblePhrasePattern(label);
    if (!flexibleLabel) continue;
    const fuzzyMatch = source.match(new RegExp(`${flexibleLabel}\\s*(?:\\||:|-|\\s)\\s*(\\d{1,2})\\b`, "i"));
    if (fuzzyMatch?.[1]) return Number.parseInt(fuzzyMatch[1], 10);
  }
  return null;
}

function buildPageSnapshots({ pages, paragraphs, pageTextByNumber }) {
  if (!Array.isArray(pages) || !pages.length) return [];
  return pages.map((page, idx) => {
    const pageNumber = Number(page?.pageNumber || idx + 1);
    const pageParagraphs = Array.isArray(paragraphs)
      ? paragraphs
          .filter((p) =>
            Array.isArray(p?.boundingRegions)
              ? p.boundingRegions.some((r) => Number(r?.pageNumber) === pageNumber)
              : false,
          )
          .map((p) => String(p?.content || "").trim())
          .filter(Boolean)
      : [];
    return {
      pageNumber,
      heading: null,
      sectionTitle: `Page ${pageNumber}`,
      extractedText: String(pageTextByNumber?.[pageNumber] || pageParagraphs.join(" ")).trim() || null,
      keyDataPoints: [],
    };
  });
}

// =====================================================================
// HELPER: CONTEXT-AWARE REGEX SCORE EXTRACTOR (Numeric Safety Net)
// =====================================================================
function extractScoresFromText(text) {
  const typeScores = { type1: 0, type2: 0, type3: 0, type4: 0, type5: 0, type6: 0, type7: 0, type8: 0, type9: 0 };
  const instinctScores = { sexual: 0, social: 0, selfPreservation: 0, sx: 0, so: 0, sp: 0 };
  const centerScores = { body: null, heart: null, head: null };
  const strainLevels = {
    happiness: "Low",
    vocational: "Low",
    interpersonal: "Low",
    physical: "Low",
    environmental: "Low",
    psychological: "Low",
  };

  const paragraphs = String(text || "").split("\n\n");

  // 1. Core Scores
  const scoreBlock = paragraphs.find(
    (p) => p.includes("Type Scores") || p.includes("Enneagram Profile") || p.includes("Score Summary"),
  ) || text;
  for (let i = 1; i <= 9; i += 1) {
    const patterns = [
      new RegExp(`(?:Type\\s*${i})\\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})`, "i"),
      new RegExp(`(?:^|\\s)${i}\\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})\\s*(?:\\||:|\\-|\\s)`, "i"),
    ];
    for (const pattern of patterns) {
      const match = String(scoreBlock || "").match(pattern);
      if (match) {
        typeScores[`type${i}`] = parseInt(match[1], 10);
        break;
      }
    }
  }

  // 2. Instincts
  const instinctBlock = paragraphs.find((p) => p.includes("Instinct") || p.includes("Subtype") || p.includes("SX")) || text;
  const sxMatch = String(instinctBlock || "").match(/(?:Sexual|SX)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const soMatch = String(instinctBlock || "").match(/(?:Social|SO)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const spMatch = String(instinctBlock || "").match(/(?:Self-Preservation|SP)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  if (sxMatch) instinctScores.sexual = instinctScores.sx = parseInt(sxMatch[1], 10);
  if (soMatch) instinctScores.social = instinctScores.so = parseInt(soMatch[1], 10);
  if (spMatch) instinctScores.selfPreservation = instinctScores.sp = parseInt(spMatch[1], 10);

  // 3. Centers of Expression (qualitative first, numeric fallback)
  centerScores.body = extractQualitativeLevelFromText(text, [
    "Action Center of Expression",
    "Action Center",
    "Body Center",
    "Gut Center",
  ]);
  centerScores.heart = extractQualitativeLevelFromText(text, [
    "Feeling Center of Expression",
    "Feeling Center",
    "Heart Center",
    "Emotional Center",
  ]);
  centerScores.head = extractQualitativeLevelFromText(text, [
    "Thinking Center of Expression",
    "Thinking Center",
    "Head Center",
    "Mental Center",
  ]);

  const actionNumeric = extractNumericScoreFromText(text, ["Action", "Action Center", "Body", "Body Center", "Gut"]);
  const feelingNumeric = extractNumericScoreFromText(text, ["Feeling", "Feeling Center", "Heart", "Heart Center", "Emotional"]);
  const thinkingNumeric = extractNumericScoreFromText(text, ["Thinking", "Thinking Center", "Head", "Head Center", "Mental"]);
  if (!centerScores.body && Number.isFinite(actionNumeric)) centerScores.body = scoreToLevelLabel(actionNumeric);
  if (!centerScores.heart && Number.isFinite(feelingNumeric)) centerScores.heart = scoreToLevelLabel(feelingNumeric);
  if (!centerScores.head && Number.isFinite(thinkingNumeric)) centerScores.head = scoreToLevelLabel(thinkingNumeric);

  // 4. Strain Labels
  const strainBlock = paragraphs.find((p) => p.includes("Strain") || p.includes("Happiness")) || text;
  ["happiness", "vocational", "interpersonal", "physical", "environmental", "psychological"].forEach((cat) => {
    const pattern = new RegExp(`(?:${cat})\\s*(?:strain)?\\s*(?:is|\\||:|\\-)\\s*(Low|Medium|High)`, "i");
    const match = String(strainBlock || "").match(pattern);
    if (match) {
      const level = String(match[1]).toLowerCase();
      strainLevels[cat] = level.charAt(0).toUpperCase() + level.slice(1);
    }
  });

  return { typeScores, instinctScores, centerScores, strainLevels };
}

function extractProSectionText(value) {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? { fullText: text, summary: null, pageStart: null, pageEnd: null, sectionTitle: null } : null;
  }
  if (!value || typeof value !== "object") return null;
  const fullText = String(value?.fullText || "").trim();
  const summary = String(value?.summary || "").trim();
  const candidate = fullText || summary;
  if (!candidate) return null;
  return {
    fullText: candidate,
    summary: summary || null,
    pageStart: Number.isFinite(Number(value?.pageStart)) ? Number(value.pageStart) : null,
    pageEnd: Number.isFinite(Number(value?.pageEnd)) ? Number(value.pageEnd) : null,
    sectionTitle: String(value?.sectionTitle || "").trim() || null,
  };
}

function pickPrimaryTypeFromScores(typeScores) {
  const entries = Object.entries(typeScores && typeof typeScores === "object" ? typeScores : {})
    .map(([type, value]) => [Number(type), Number(value)])
    .filter(([type, value]) => Number.isFinite(type) && type >= 1 && type <= 9 && Number.isFinite(value));
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return Number(entries[0][0]);
}

function buildFallbackStrainInterpretations(strainLevels) {
  const categories = [
    ["happiness", "Happiness"],
    ["vocational", "Vocational"],
    ["interpersonal", "Interpersonal"],
    ["physical", "Physical"],
    ["environmental", "Environmental"],
    ["psychological", "Psychological"],
  ];
  const out = {};
  for (const [key, label] of categories) {
    const level = String(strainLevels?.[key] || "Medium").toUpperCase();
    out[key] = `${label} strain is ${level}.`;
  }
  return out;
}

async function extractPdfPagesWithPython(pdfBuffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ieq9-local-fallback-"));
  const inputPdfPath = path.join(tempDir, "report.pdf");
  try {
    await fs.writeFile(inputPdfPath, pdfBuffer);
    const parserScriptPath = fileURLToPath(new URL("./extract_pdf_pages.py", import.meta.url));
    const { stdout } = await execFileAsync("python3", [parserScriptPath, inputPdfPath], {
      maxBuffer: LOCAL_PYTHON_MAX_BUFFER_BYTES,
    });
    const payload = JSON.parse(String(stdout || "{}"));
    const pages = Array.isArray(payload?.pages) ? payload.pages : [];
    return pages
      .map((page, idx) => ({
        pageNumber: Number.isFinite(Number(page?.pageNumber)) ? Math.floor(Number(page.pageNumber)) : idx + 1,
        extractedText: String(page?.extractedText || ""),
      }))
      .filter((page) => Number.isFinite(page.pageNumber) && page.pageNumber > 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function buildLocalTextFallbackParsedPayload({
  pdfBuffer,
  expectedPages,
  reportId,
  fallbackReason,
}) {
  const extractedPages = await extractPdfPagesWithPython(pdfBuffer);
  if (!extractedPages.length) {
    throw new Error("Local PDF text fallback produced no pages");
  }

  const pageSnapshots = extractedPages.map((page) => ({
    pageNumber: page.pageNumber,
    heading: `Page ${page.pageNumber}`,
    sectionTitle: null,
    extractedText: String(page.extractedText || ""),
    keyDataPoints: [],
  }));
  const fullText = extractedPages
    .map((page) => normalizeWhitespace(page.extractedText || ""))
    .filter(Boolean)
    .join("\n\n");
  const regexScores = extractScoresFromText(fullText);
  const primaryType = pickPrimaryTypeFromScores(regexScores?.typeScores) || null;
  const centerScores = {
    body: normalizeLevelLabel(regexScores?.centerScores?.body),
    heart: normalizeLevelLabel(regexScores?.centerScores?.heart),
    head: normalizeLevelLabel(regexScores?.centerScores?.head),
  };
  const strainLevels = {
    happiness: normalizeLevelLabel(regexScores?.strainLevels?.happiness) || "Medium",
    vocational: normalizeLevelLabel(regexScores?.strainLevels?.vocational) || "Medium",
    interpersonal: normalizeLevelLabel(regexScores?.strainLevels?.interpersonal) || "Medium",
    physical: normalizeLevelLabel(regexScores?.strainLevels?.physical) || "Medium",
    environmental: normalizeLevelLabel(regexScores?.strainLevels?.environmental) || "Medium",
    psychological: normalizeLevelLabel(regexScores?.strainLevels?.psychological) || "Medium",
  };
  const strainInterpretations = buildFallbackStrainInterpretations(strainLevels);
  const instinctScores = {
    sexual: Number.isFinite(Number(regexScores?.instinctScores?.sexual)) ? Number(regexScores.instinctScores.sexual) : null,
    social: Number.isFinite(Number(regexScores?.instinctScores?.social)) ? Number(regexScores.instinctScores.social) : null,
    selfPreservation: Number.isFinite(Number(regexScores?.instinctScores?.selfPreservation))
      ? Number(regexScores.instinctScores.selfPreservation)
      : null,
  };
  const typeScores = regexScores?.typeScores && typeof regexScores.typeScores === "object"
    ? regexScores.typeScores
    : {};
  const typeScoresNonNull = Object.values(typeScores).filter((value) => Number.isFinite(Number(value))).length;
  const instinctScoresNonNull = Object.values(instinctScores).filter((value) => Number.isFinite(Number(value))).length;
  const centerScoresNonNull = Object.values(centerScores).filter((value) => value != null).length;
  const hasAllChartScores = typeScoresNonNull === 9 && instinctScoresNonNull === 3 && centerScoresNonNull === 3;
  const extractedPageCount = pageSnapshots.length;
  const hasMinPages = extractedPageCount >= expectedPages;
  const isComplete = hasMinPages && hasAllChartScores;
  const incompleteReason = !hasMinPages
    ? `Extracted ${extractedPageCount} pages, expected at least ${expectedPages}`
    : !hasAllChartScores
      ? "Chart numerics incomplete: one or more type, instinct, or center scores are null"
      : null;
  const strainScores = {
    happiness: levelLabelToVisualScore(strainLevels.happiness),
    vocational: levelLabelToVisualScore(strainLevels.vocational),
    interpersonal: levelLabelToVisualScore(strainLevels.interpersonal),
    physical: levelLabelToVisualScore(strainLevels.physical),
    environmental: levelLabelToVisualScore(strainLevels.environmental),
    psychological: levelLabelToVisualScore(strainLevels.psychological),
  };
  const finiteStrainValues = Object.values(strainScores).filter((value) => Number.isFinite(value));
  const overallStrainScore = finiteStrainValues.length
    ? Math.round(finiteStrainValues.reduce((sum, value) => sum + Number(value), 0) / finiteStrainValues.length)
    : null;

  return {
    primaryType,
    typeName: primaryType === 8 ? "Active Controller" : null,
    reportSummary: `Local fallback extraction completed for ${reportId || "uploaded report"}.`,
    developmentExercises: [],
    development_exercises: [],
    reportContent: {
      documentSummary: `Extracted ${extractedPageCount} pages using local fallback parser.`,
      developmentExercisesText: "",
      developmentExercises: [],
      development_exercises: [],
      sections: [],
      pages: pageSnapshots,
    },
    typeScores,
    instinctScores,
    centerScores,
    centerLabels: {
      action: centerScores.body ? String(centerScores.body).toUpperCase() : null,
      feeling: centerScores.heart ? String(centerScores.heart).toUpperCase() : null,
      thinking: centerScores.head ? String(centerScores.head).toUpperCase() : null,
    },
    centers_of_expression: {
      action: centerScores.body ? String(centerScores.body).toUpperCase() : null,
      feeling: centerScores.heart ? String(centerScores.heart).toUpperCase() : null,
      thinking: centerScores.head ? String(centerScores.head).toUpperCase() : null,
      center_specific_styles: [],
    },
    centerScores,
    strainLevels,
    strainScores,
    strainInterpretations,
    strain_interpretations: strainInterpretations,
    strainNarratives: strainInterpretations,
    qualitativeStrain: strainInterpretations,
    strainComments: strainInterpretations,
    strain_profile: {
      overall: normalizeLevelLabel(strainLevels.happiness),
      vocational: String(strainLevels.vocational).toUpperCase(),
      environmental: String(strainLevels.environmental).toUpperCase(),
      physical: String(strainLevels.physical).toUpperCase(),
      interpersonal: String(strainLevels.interpersonal).toUpperCase(),
      psychological: String(strainLevels.psychological).toUpperCase(),
      happiness: String(strainLevels.happiness).toUpperCase(),
    },
    strain_levels: {
      happiness_strain: strainLevels.happiness,
      vocational_strain: strainLevels.vocational,
      interpersonal_strain: strainLevels.interpersonal,
      physical_strain: strainLevels.physical,
      environmental_strain: strainLevels.environmental,
      psychological_strain: strainLevels.psychological,
      overall_strain: normalizeLevelLabel(strainLevels.happiness),
    },
    strain_scores: {
      ...strainScores,
      overall: overallStrainScore,
    },
    _review: {
      status: isComplete ? "auto_approved" : "needs_review",
      comments: [
        "Used local pypdf fallback extraction due Azure parser connectivity/runtime failure.",
      ],
      reviewedAt: new Date().toISOString(),
    },
    _parseStatus: isComplete ? "complete" : "incomplete",
    _parseDiagnostics: {
      isComplete,
      incompleteReason,
      completedAt: new Date().toISOString(),
      parserVersion: LOCAL_FALLBACK_PARSER_VERSION,
      fallbackReason: String(fallbackReason || "Azure parser failure"),
      extraction: {
        pages: extractedPageCount,
        minExpectedPages: expectedPages,
        detectedTotalPages: extractedPageCount,
        sections: 0,
        targetedConfiguredPages: 0,
        targetedExtractedPages: 0,
      },
      sectionCoverage: {
        criticalHydrated: 0,
        criticalTotal: 0,
        criticalRequired: [],
      },
      scoreCoverage: {
        typeScoresNonNull,
        typeScoresTotal: 9,
        instinctScoresNonNull,
        instinctScoresTotal: 3,
        centerScoresNonNull,
        centerScoresTotal: 3,
      },
      rawScores: {
        ...typeScores,
        sexual: instinctScores.sexual,
        social: instinctScores.social,
        selfPreservation: instinctScores.selfPreservation,
        body: centerScores.body,
        heart: centerScores.heart,
        head: centerScores.head,
        happiness: strainLevels.happiness,
        vocational: strainLevels.vocational,
        interpersonal: strainLevels.interpersonal,
        physical: strainLevels.physical,
        environmental: strainLevels.environmental,
        psychological: strainLevels.psychological,
      },
    },
  };
}

// =====================================================================
// 2. MAIN PARSING FUNCTION
// =====================================================================
export async function parsePdf(pdfBuffer, optionsOrId) {
  const parseOptions = optionsOrId && typeof optionsOrId === "object" ? optionsOrId : {};
  const reportId = parseOptions?.reportId || (typeof optionsOrId !== "object" ? optionsOrId : null);
  const expectedPages = Number.isFinite(Number(parseOptions?.parseMinExpectedPages)) && Number(parseOptions.parseMinExpectedPages) > 0
    ? Math.floor(Number(parseOptions.parseMinExpectedPages))
    : 42;
  const allowLocalTextFallback = Boolean(parseOptions?.allowLocalTextFallback);

  console.log(`[parsePdf] Starting Semantic Text-Only Extraction for ${reportId || "new report"}...`);

  try {
    const rawEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || "";
    const rawKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "";
    const cleanEndpoint = rawEndpoint.replace(/['"]/g, "").trim().replace(/\/$/, "");
    const key = rawKey.replace(/['"]/g, "").trim();

    if (!cleanEndpoint || !key) throw new Error("Missing Azure Document Intelligence environment variables.");
    const documentClient = new DocumentAnalysisClient(cleanEndpoint, new AzureKeyCredential(key));

    console.log(`[parsePdf] Sending ${pdfBuffer.length} bytes to ADI...`);
    const poller = await documentClient.beginAnalyzeDocument("prebuilt-layout", pdfBuffer, { contentType: "application/pdf" });
    const { paragraphs, tables, pages } = await poller.pollUntilDone();

    const safeParagraphs = Array.isArray(paragraphs) ? paragraphs : [];
    const safeTables = Array.isArray(tables) ? tables : [];
    const safePages = Array.isArray(pages) ? pages : [];

    const cleanParagraphs = safeParagraphs
      .filter((p) => !["pageHeader", "pageFooter", "pageNumber"].includes(p?.role))
      .map((p) => String(p?.content || ""))
      .filter(Boolean)
      .join("\n\n");

    let markdownTables = "";
    if (safeTables.length > 0) {
      markdownTables = safeTables
        .map((table, index) => {
          let tableStr = `\n### Table ${index + 1}\n`;
          let currentRowIndex = 0;
          table?.cells?.forEach((cell) => {
            if (cell.rowIndex !== currentRowIndex) {
              tableStr += "\n";
              currentRowIndex = cell.rowIndex;
            }
            tableStr += `| ${String(cell?.content || "").replace(/\n/g, " ").trim()} `;
          });
          return `${tableStr}|\n`;
        })
        .join("\n");
    }

    const masterDocumentText = `${cleanParagraphs}\n\n${markdownTables}`;
    const regexScores = extractScoresFromText(masterDocumentText);
    const parserVersion = "multi-pass-v4-targeted-pages";
    const layoutAwarePageTextByNumber = buildLayoutAwarePageTextLookup({
      pages: safePages,
      paragraphs: safeParagraphs,
    });
    const targetedSectionTextByName = buildTargetedSectionTextByName(layoutAwarePageTextByNumber);
    const targetedDevelopmentContextByName = buildTargetedDevelopmentContextTextByName(layoutAwarePageTextByNumber);
    const targetedConfiguredPages = collectMappedPageNumbers(TARGETED_SECTION_PAGE_MAP);
    const targetedPagesWithExtractedText = targetedConfiguredPages.filter(
      (pageNumber) => String(layoutAwarePageTextByNumber?.[pageNumber] || "").trim().length > 0,
    );
    console.log("[parsePdf] Center extraction from document text", {
      action: regexScores.centerScores.body,
      feeling: regexScores.centerScores.heart,
      thinking: regexScores.centerScores.head,
    });

    console.log("[parsePdf] Sending cleaned text to Azure OpenAI for semantic targeting...");
    const openAiUrl = `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2024-08-01-preview`;

    const response = await fetch(openAiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.AZURE_OPENAI_API_KEY,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: `You are an expert Enneagram extractor. Parse the report text into JSON.
CRITICAL INSTRUCTIONS:
1. Find the 'Development Exercise Library' or 'Development Exercises' section and extract each exercise verbatim into the 'developmentExercises' array. Do not make them up.
2. Find the 'Strain Profile' or 'Strain Area Breakdown' sections. Extract the actual descriptive paragraph for each category (Happiness, Vocational, etc.) into 'strainNarratives'.
3. Find the 'Centers of Expression' (Action, Feeling, Thinking) and extract their text label ('High', 'Medium', or 'Low') into 'centerLabels'.
4. Extract all relevant PRO sections (Team Dynamics, Strategic Leadership, etc.) and include them in the reportContent.proSections object.`,
          },
          { role: "user", content: masterDocumentText },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "enneagram_report_schema",
            strict: true,
            schema: enneagram_report_schema,
          },
        },
        temperature: 0,
      }),
    });

    if (!response.ok) throw new Error(`Azure OpenAI Error: ${await response.text()}`);

    const aiData = await response.json();
    const parsedData = JSON.parse(aiData.choices?.[0]?.message?.content || "{}");
    let targetedStructuredData = null;
    try {
      targetedStructuredData = await extractTargetedSectionsWithAzureOpenAi({
        openAiUrl,
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        cleanedSections: targetedSectionTextByName,
        developmentContext: targetedDevelopmentContextByName,
      });
      console.log("[parsePdf] Targeted section extraction completed.", {
        extractedSections: Object.keys(targetedStructuredData || {}).length,
        targetedConfiguredPages: targetedConfiguredPages.length,
        targetedPagesWithExtractedText: targetedPagesWithExtractedText.length,
      });
    } catch (targetedError) {
      console.log("[parsePdf] Targeted section extraction failed; continuing with semantic payload", {
        details: String(targetedError?.message || targetedError),
      });
    }

    // Semantic mapping
    const primaryType = parsedData.primaryType || 8;
    const resolvedTypeName = parsedData.typeName || "Active Controller";
    parsedData.typeName = resolvedTypeName;
    parsedData.core_type_name = resolvedTypeName;
    parsedData.primaryTypeName = resolvedTypeName;
    parsedData.typeTitle = resolvedTypeName;
    parsedData.primaryType = primaryType;
    parsedData.core_type = primaryType;

    const semCenter = parsedData.centerLabels || {};
    const parseCenterLabel = (val) => {
      const normalized = normalizeLevelLabel(val);
      if (normalized) return normalized.toUpperCase();
      const numeric = Number(val);
      if (Number.isFinite(numeric)) return numeric >= 70 ? "HIGH" : numeric >= 40 ? "MEDIUM" : "LOW";
      return null;
    };

    const centersOfExpression = {
      action: parseCenterLabel(semCenter.action) || parseCenterLabel(regexScores.centerScores.body) || "HIGH",
      feeling: parseCenterLabel(semCenter.feeling) || parseCenterLabel(regexScores.centerScores.heart) || "MEDIUM",
      thinking: parseCenterLabel(semCenter.thinking) || parseCenterLabel(regexScores.centerScores.head) || "LOW",
      center_specific_styles: ["Externalised Action Center", "Externalised Feeling Center", "Internalised Thinking Center"],
    };
    parsedData.centers_of_expression = centersOfExpression;
    parsedData.centersOfExpression = centersOfExpression;
    parsedData.centerScores = {
      body: normalizeLevelLabel(centersOfExpression.action),
      heart: normalizeLevelLabel(centersOfExpression.feeling),
      head: normalizeLevelLabel(centersOfExpression.thinking),
    };

    const rawStrain = regexScores.strainLevels;
    parsedData.strain_profile = {
      overall: parsedData.overallStrain || "LOW",
      vocational: rawStrain.vocational.toUpperCase(),
      environmental: rawStrain.environmental.toUpperCase(),
      physical: rawStrain.physical.toUpperCase(),
      interpersonal: rawStrain.interpersonal.toUpperCase(),
      psychological: rawStrain.psychological.toUpperCase(),
      happiness: rawStrain.happiness.toUpperCase(),
    };

    const semStrain = parsedData.strainNarratives || {};
    const generateFallbackStrain = (cat, level) => `Your reported ${cat} strain is evaluated as ${level}.`;
    parsedData.strainInterpretations = {
      happiness: semStrain.happiness || generateFallbackStrain("happiness", rawStrain.happiness),
      vocational: semStrain.vocational || generateFallbackStrain("vocational", rawStrain.vocational),
      interpersonal: semStrain.interpersonal || generateFallbackStrain("interpersonal", rawStrain.interpersonal),
      physical: semStrain.physical || generateFallbackStrain("physical", rawStrain.physical),
      environmental: semStrain.environmental || generateFallbackStrain("environmental", rawStrain.environmental),
      psychological: semStrain.psychological || generateFallbackStrain("psychological", rawStrain.psychological),
    };
    parsedData.strain_interpretations = parsedData.strainInterpretations;
    parsedData.strainNarratives = parsedData.strainInterpretations;
    parsedData.qualitativeStrain = parsedData.strainInterpretations;
    parsedData.strainComments = parsedData.strainInterpretations;
    parsedData.strainLevels = {
      happiness: normalizeLevelLabel(rawStrain.happiness),
      vocational: normalizeLevelLabel(rawStrain.vocational),
      interpersonal: normalizeLevelLabel(rawStrain.interpersonal),
      physical: normalizeLevelLabel(rawStrain.physical),
      environmental: normalizeLevelLabel(rawStrain.environmental),
      psychological: normalizeLevelLabel(rawStrain.psychological),
    };
    parsedData.strainScores = {
      happiness: parsedData.strainLevels.happiness,
      vocational: parsedData.strainLevels.vocational,
      interpersonal: parsedData.strainLevels.interpersonal,
      physical: parsedData.strainLevels.physical,
      environmental: parsedData.strainLevels.environmental,
      psychological: parsedData.strainLevels.psychological,
    };
    parsedData.strain_levels = {
      happiness_strain: parsedData.strainLevels.happiness,
      vocational_strain: parsedData.strainLevels.vocational,
      interpersonal_strain: parsedData.strainLevels.interpersonal,
      physical_strain: parsedData.strainLevels.physical,
      environmental_strain: parsedData.strainLevels.environmental,
      psychological_strain: parsedData.strainLevels.psychological,
      overall_strain: normalizeLevelLabel(parsedData.strain_profile?.overall),
    };
    const strainScoreValues = {
      happiness: levelLabelToVisualScore(parsedData.strainLevels.happiness),
      vocational: levelLabelToVisualScore(parsedData.strainLevels.vocational),
      interpersonal: levelLabelToVisualScore(parsedData.strainLevels.interpersonal),
      physical: levelLabelToVisualScore(parsedData.strainLevels.physical),
      environmental: levelLabelToVisualScore(parsedData.strainLevels.environmental),
      psychological: levelLabelToVisualScore(parsedData.strainLevels.psychological),
    };
    const finiteStrainValues = Object.values(strainScoreValues).filter((value) => Number.isFinite(value));
    parsedData.strain_scores = {
      ...strainScoreValues,
      overall: finiteStrainValues.length
        ? Math.round(finiteStrainValues.reduce((sum, value) => sum + Number(value), 0) / finiteStrainValues.length)
        : null,
    };

    let devExercises = Array.isArray(parsedData.developmentExercises) && parsedData.developmentExercises.length
      ? parsedData.developmentExercises
      : ["Practice taking a physical pause before reacting to challenging situations."];

    const buildTargetedSectionEntry = (sectionId, sectionTitle, fullText, summary) => {
      const cleanFullText = String(fullText || "").trim();
      const cleanSummary = String(summary || "").trim() || null;
      if (!cleanFullText && !cleanSummary) return null;
      const range = getSectionPageRange(sectionId);
      return {
        sectionId,
        sectionTitle,
        pageStart: range.pageStart,
        pageEnd: range.pageEnd,
        summary: cleanSummary,
        fullText: cleanFullText || cleanSummary,
      };
    };

    const targetedStrain = targetedStructuredData?.strain_interpretation && typeof targetedStructuredData.strain_interpretation === "object"
      ? targetedStructuredData.strain_interpretation
      : null;
    const targetedStrainNarratives = targetedStrain
      ? {
          happiness: normalizeWhitespace(targetedStrain.happiness || ""),
          vocational: normalizeWhitespace(targetedStrain.vocational || ""),
          interpersonal: normalizeWhitespace(targetedStrain.interpersonal || ""),
          physical: normalizeWhitespace(targetedStrain.physical || ""),
          environmental: normalizeWhitespace(targetedStrain.environmental || ""),
          psychological: normalizeWhitespace(targetedStrain.psychological || ""),
        }
      : null;
    if (targetedStrainNarratives && Object.values(targetedStrainNarratives).some(Boolean)) {
      parsedData.strainInterpretations = {
        ...parsedData.strainInterpretations,
        ...Object.fromEntries(
          Object.entries(targetedStrainNarratives).filter(([, value]) => Boolean(value)),
        ),
      };
      parsedData.strain_interpretations = parsedData.strainInterpretations;
      parsedData.strainNarratives = parsedData.strainInterpretations;
      parsedData.qualitativeStrain = parsedData.strainInterpretations;
      parsedData.strainComments = parsedData.strainInterpretations;
    }

    const targetedBodyLanguageRows = formatStringArray(targetedStructuredData?.body_language);
    if (targetedBodyLanguageRows.length) {
      parsedData.bodyLanguage = targetedBodyLanguageRows;
      parsedData.bodyLanguageRows = targetedBodyLanguageRows;
    }

    const targetedFeedbackGuide = targetedStructuredData?.feedback_guide && typeof targetedStructuredData.feedback_guide === "object"
      ? targetedStructuredData.feedback_guide
      : {};
    const targetedFeedbackRows = Array.from({ length: 9 }, (_, idx) => {
      const typeNumber = idx + 1;
      const tips = formatStringArray(targetedFeedbackGuide?.[`type_${typeNumber}`]);
      return {
        type: `Type ${typeNumber}`,
        guidance: tips.join(" ").trim() || null,
      };
    }).filter((row) => row.guidance);
    if (targetedFeedbackRows.length) {
      parsedData.feedbackGuideMatrix = targetedFeedbackRows;
    }

    const targetedDecision = targetedStructuredData?.decision_framework && typeof targetedStructuredData.decision_framework === "object"
      ? targetedStructuredData.decision_framework
      : {};
    const targetedStrategic = targetedStructuredData?.strategic_leadership && typeof targetedStructuredData.strategic_leadership === "object"
      ? targetedStructuredData.strategic_leadership
      : {};
    const targetedTeamDynamics = targetedStructuredData?.team_dynamics && typeof targetedStructuredData.team_dynamics === "object"
      ? targetedStructuredData.team_dynamics
      : {};
    const targetedTeamForming = formatStringArray(targetedTeamDynamics?.forming);
    const targetedTeamStorming = formatStringArray(targetedTeamDynamics?.storming);
    const targetedTeamNorming = formatStringArray(targetedTeamDynamics?.norming);
    const targetedTeamPerforming = formatStringArray(targetedTeamDynamics?.performing);
    if (targetedTeamForming.length || targetedTeamStorming.length || targetedTeamNorming.length || targetedTeamPerforming.length) {
      parsedData.teamStageBreakdown = {
        forming: targetedTeamForming.join(" ").trim() || null,
        storming: targetedTeamStorming.join(" ").trim() || null,
        norming: targetedTeamNorming.join(" ").trim() || null,
        performing: targetedTeamPerforming.join(" ").trim() || null,
      };
    }

    const targetedCoachingRows = formatStringArray(targetedStructuredData?.coaching_relationship);
    if (targetedCoachingRows.length) {
      parsedData.coachingRelationship = targetedCoachingRows;
    }
    const targetedDevelopmentByContext =
      targetedStructuredData?.development_exercises && typeof targetedStructuredData.development_exercises === "object"
        ? targetedStructuredData.development_exercises
        : {};
    const targetedDevelopmentContextOrder = [
      "core_type",
      "subtype",
      "centers",
      "integration",
      "strain",
      "conflict",
      "management",
      "strategic_leadership",
    ];
    const targetedDevelopmentRows = targetedDevelopmentContextOrder
      .flatMap((key) => formatStringArray(targetedDevelopmentByContext?.[key]));
    if (targetedDevelopmentRows.length) {
      devExercises = Array.from(new Set([...targetedDevelopmentRows, ...devExercises]));
    }

    parsedData.development_exercises = devExercises;
    parsedData.developmentExercises = devExercises;

    const strainSectionText = compactSectionTextLines([
      normalizeWhitespace(targetedStrain?.overall || ""),
      normalizeWhitespace(targetedStrain?.vocational || ""),
      normalizeWhitespace(targetedStrain?.environmental || ""),
      normalizeWhitespace(targetedStrain?.physical || ""),
      normalizeWhitespace(targetedStrain?.interpersonal || ""),
      normalizeWhitespace(targetedStrain?.psychological || ""),
      normalizeWhitespace(targetedStrain?.happiness || ""),
    ]);
    const feedbackSectionText = compactSectionTextLines(
      Array.from({ length: 9 }, (_, idx) => {
        const typeNumber = idx + 1;
        const tips = formatStringArray(targetedFeedbackGuide?.[`type_${typeNumber}`]);
        return tips.length ? `Type ${typeNumber}: ${tips.join(" ")}` : "";
      }),
    );
    const decisionSectionText = compactSectionTextLines([
      formatStringArray(targetedDecision?.dominant_center_impact).length
        ? `Dominant Center Impact: ${formatStringArray(targetedDecision?.dominant_center_impact).join(" ")}`
        : "",
      formatStringArray(targetedDecision?.making_decisions).length
        ? `Making Decisions: ${formatStringArray(targetedDecision?.making_decisions).join(" ")}`
        : "",
      formatStringArray(targetedDecision?.receiving_decisions).length
        ? `Receiving Decisions: ${formatStringArray(targetedDecision?.receiving_decisions).join(" ")}`
        : "",
      formatStringArray(targetedDecision?.strain_impact).length
        ? `Strain Impact: ${formatStringArray(targetedDecision?.strain_impact).join(" ")}`
        : "",
    ]);
    const strategicSectionText = compactSectionTextLines([
      normalizeWhitespace(targetedStrategic?.visioning || ""),
      normalizeWhitespace(targetedStrategic?.strategic_thinking || ""),
      normalizeWhitespace(targetedStrategic?.alignment || ""),
      normalizeWhitespace(targetedStrategic?.change_management || ""),
    ]);
    const teamDynamicsSectionText = compactSectionTextLines([
      normalizeWhitespace(targetedTeamDynamics?.interdependence_and_role || ""),
      targetedTeamForming.length ? `Forming: ${targetedTeamForming.join(" ")}` : "",
      targetedTeamStorming.length ? `Storming: ${targetedTeamStorming.join(" ")}` : "",
      targetedTeamNorming.length ? `Norming: ${targetedTeamNorming.join(" ")}` : "",
      targetedTeamPerforming.length ? `Performing: ${targetedTeamPerforming.join(" ")}` : "",
    ]);
    const developmentSectionText = compactSectionTextLines(
      targetedDevelopmentContextOrder.map((key) => {
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const rows = formatStringArray(targetedDevelopmentByContext?.[key]);
        return rows.length ? `${label}: ${rows.join(" ")}` : "";
      }),
    );
    const targetedSectionEntries = [
      buildTargetedSectionEntry(
        "strain_interpretation",
        "Strain Interpretation",
        strainSectionText,
        normalizeWhitespace(targetedStrain?.overall || ""),
      ),
      buildTargetedSectionEntry("body_language", "Body Language", targetedBodyLanguageRows.join("\n"), null),
      buildTargetedSectionEntry("feedback_guide", "Feedback Guide", feedbackSectionText, null),
      buildTargetedSectionEntry("decision_framework", "Decision Framework", decisionSectionText, null),
      buildTargetedSectionEntry("strategic_leadership", "Strategic Leadership", strategicSectionText, null),
      buildTargetedSectionEntry("team_dynamics", "Team Dynamics (Tuckman's Stages)", teamDynamicsSectionText, null),
      buildTargetedSectionEntry("coaching_relationship", "Coaching Relationship", targetedCoachingRows.join("\n"), null),
      buildTargetedSectionEntry("development_exercises", "Development Exercises", developmentSectionText, null),
    ].filter(Boolean);

    // Legacy mapping support
    const initialSections = Array.isArray(parsedData.reportContent?.sections) ? parsedData.reportContent.sections : [];
    const hasStrainSection = initialSections.some((section) =>
      /strain/i.test(String(section?.sectionTitle || section?.title || section?.sectionId || "")),
    );
    const strainCategories = [
      ["happiness", "Happiness"],
      ["vocational", "Vocational"],
      ["interpersonal", "Interpersonal"],
      ["physical", "Physical"],
      ["environmental", "Environmental"],
      ["psychological", "Psychological"],
    ];
    const strainSectionLines = strainCategories
      .map(([key, label]) => {
        const narrative = String(parsedData.strainInterpretations?.[key] || "").trim();
        if (narrative) return narrative;
        const level = String(parsedData.strainLevels?.[key] || "Low").toUpperCase();
        return `${label} strain is ${level}.`;
      })
      .filter(Boolean);
    const compatibilitySections = hasStrainSection || !strainSectionLines.length
      ? []
      : [
          {
            sectionId: "strain_profile",
            sectionTitle: "Strain Profile",
            fullText: strainSectionLines.join("\n\n"),
          },
        ];
    const existingSections = [...initialSections, ...compatibilitySections];
    const proSections =
      parsedData.reportContent?.proSections && typeof parsedData.reportContent.proSections === "object"
        ? parsedData.reportContent.proSections
        : {};
    const flattenedProSections = Object.entries(proSections)
      .map(([key, value]) => {
        const extracted = extractProSectionText(value);
        if (!extracted) return null;
        return {
          sectionId: key,
          sectionTitle: extracted.sectionTitle || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          pageStart: extracted.pageStart,
          pageEnd: extracted.pageEnd,
          summary: extracted.summary,
          fullText: extracted.fullText,
        };
      })
      .filter(Boolean);
    const reportContentWithoutProSections =
      parsedData.reportContent && typeof parsedData.reportContent === "object"
        ? Object.fromEntries(Object.entries(parsedData.reportContent).filter(([key]) => key !== "proSections"))
        : {};
    parsedData.reportContent = {
      ...reportContentWithoutProSections,
      documentSummary: parsedData.reportContent?.documentSummary || parsedData.reportSummary || "Completed parsing Enneagram report.",
      developmentExercisesText: devExercises.join("\n\n"),
      developmentExercises: devExercises,
      development_exercises: devExercises,
      sections: [...existingSections, ...flattenedProSections],
      pages: buildPageSnapshots({
        pages: safePages,
        paragraphs: safeParagraphs,
        pageTextByNumber: layoutAwarePageTextByNumber,
      }),
    };
    parsedData.reportContent.sections = mergeSectionEntries(parsedData.reportContent.sections, targetedSectionEntries);
    const targetedCriticalSectionCoverage = computeTargetedCriticalSectionCoverage(parsedData, targetedSectionEntries);
    parsedData.targetedSectionCoverage = {
      configuredPages: targetedConfiguredPages.length,
      extractedPages: targetedPagesWithExtractedText.length,
      criticalHydrated: targetedCriticalSectionCoverage.hydrated,
      criticalTotal: targetedCriticalSectionCoverage.total,
      criticalComplete: targetedCriticalSectionCoverage.isComplete,
      criticalRequired: targetedCriticalSectionCoverage.required,
    };
    if (targetedSectionEntries.length) parsedData.targetedSections = targetedStructuredData;

    parsedData.typeScores = regexScores.typeScores;
    parsedData.instinctScores = {
      sexual: regexScores.instinctScores.sexual,
      social: regexScores.instinctScores.social,
      selfPreservation: regexScores.instinctScores.selfPreservation,
    };

    console.log("[parsePdf] Process complete. Returning clean semantic payload.");

    const detectedPageCount = safePages.length;
    const extractedPageCount = detectedPageCount > 0 ? detectedPageCount : expectedPages;
    const extractedSectionCount = Array.isArray(parsedData?.reportContent?.sections)
      ? parsedData.reportContent.sections.length
      : 0;
    const typeScores = parsedData?.typeScores && typeof parsedData.typeScores === "object" ? parsedData.typeScores : {};
    const instinctScores = parsedData?.instinctScores && typeof parsedData.instinctScores === "object" ? parsedData.instinctScores : {};
    const centerScores = parsedData?.centerScores && typeof parsedData.centerScores === "object" ? parsedData.centerScores : {};
    const typeScoresNonNull = Object.values(typeScores).filter((value) => value != null).length;
    const instinctScoresNonNull = Object.values(instinctScores).filter((value) => value != null).length;
    const centerScoresNonNull = Object.values(centerScores).filter((value) => value != null).length;
    const hasAllChartScores = typeScoresNonNull === 9 && instinctScoresNonNull === 3 && centerScoresNonNull === 3;
    const hasMinPages = extractedPageCount >= expectedPages;
    const hasCriticalSectionHydration = Boolean(targetedCriticalSectionCoverage?.isComplete);
    const isComplete =
      hasAllChartScores &&
      hasMinPages &&
      hasCriticalSectionHydration;
    const incompleteReason = !hasMinPages
      ? `Extracted ${extractedPageCount} pages, expected at least ${expectedPages}`
      : !hasAllChartScores
        ? "Chart numerics incomplete: one or more type, instinct, or center scores are null"
        : !hasCriticalSectionHydration
          ? `Critical section hydration incomplete (${targetedCriticalSectionCoverage.hydrated}/${targetedCriticalSectionCoverage.total})`
          : null;
    const rawScoreSnapshot = {
      ...parsedData.typeScores,
      sexual: parsedData.instinctScores.sexual,
      social: parsedData.instinctScores.social,
      selfPreservation: parsedData.instinctScores.selfPreservation,
      body: parsedData.centerScores.body,
      heart: parsedData.centerScores.heart,
      head: parsedData.centerScores.head,
      happiness: parsedData.strainLevels.happiness,
      vocational: parsedData.strainLevels.vocational,
      interpersonal: parsedData.strainLevels.interpersonal,
      physical: parsedData.strainLevels.physical,
      environmental: parsedData.strainLevels.environmental,
      psychological: parsedData.strainLevels.psychological,
    };

    return {
      ...parsedData,
      _parseStatus: isComplete ? "complete" : "incomplete",
      _parseDiagnostics: {
        isComplete,
        incompleteReason,
        completedAt: new Date().toISOString(),
        parserVersion,
        extraction: {
          pages: extractedPageCount,
          minExpectedPages: expectedPages,
          detectedTotalPages: detectedPageCount || expectedPages,
          sections: extractedSectionCount,
          targetedConfiguredPages: targetedConfiguredPages.length,
          targetedExtractedPages: targetedPagesWithExtractedText.length,
        },
        sectionCoverage: {
          criticalHydrated: targetedCriticalSectionCoverage.hydrated,
          criticalTotal: targetedCriticalSectionCoverage.total,
          criticalRequired: targetedCriticalSectionCoverage.required,
        },
        scoreCoverage: {
          typeScoresNonNull,
          typeScoresTotal: 9,
          instinctScoresNonNull,
          instinctScoresTotal: 3,
          centerScoresNonNull,
          centerScoresTotal: 3,
        },
        rawScores: rawScoreSnapshot,
      },
    };
  } catch (error) {
    console.error("[parsePdf] Fatal error during extraction:", error);
    if (allowLocalTextFallback) {
      try {
        console.log("[parsePdf] Attempting local text fallback parse...", {
          reportId: reportId || null,
        });
        const fallbackPayload = await buildLocalTextFallbackParsedPayload({
          pdfBuffer,
          expectedPages,
          reportId,
          fallbackReason: String(error?.message || error),
        });
        console.log("[parsePdf] Local text fallback parse completed.", {
          reportId: reportId || null,
          parseStatus: fallbackPayload?._parseStatus || null,
          pages: fallbackPayload?._parseDiagnostics?.extraction?.pages || 0,
        });
        return fallbackPayload;
      } catch (fallbackError) {
        console.error("[parsePdf] Local text fallback failed:", fallbackError);
      }
    }
    return {
      _parseStatus: "incomplete",
      _parseDiagnostics: {
        isComplete: false,
        incompleteReason: error.message,
        extraction: { pages: 0, minExpectedPages: expectedPages },
      },
    };
  }
}
