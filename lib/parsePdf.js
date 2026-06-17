import { PDFDocument } from "pdf-lib";
import DocumentIntelligence, { getLongRunningPoller, isUnexpected } from "@azure-rest/ai-document-intelligence";
import { LlamaParseReader } from "llamaindex";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const PARSER_VERSION = "attached-agentic-ocr-v1";
const OPENAI_RETRY_BASE_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const DOC_INTEL_RETRY_BASE_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const RETRYABLE_HTTP_STATUS_CODES = new Set([408, 409, 429]);
const STREAM_DISCONNECT_ERROR_SIGNATURE = "stream disconnected before completion: response.failed event received";
const LOCAL_PYTHON_MAX_BUFFER_BYTES = 24 * 1024 * 1024;
const PYTHON_VERIFICATION_TIMEOUT_MS = 2 * 60 * 1000;
const OPENAI_REQUEST_TIMEOUT_MS = 8 * 60 * 1000;
const DOC_INTEL_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const RAW_TEXT_SINGLE_PASS_MAX_CHARS = 28_000;
const RAW_TEXT_CHUNK_MAX_CHARS = 16_000;
const RAW_TEXT_CHUNK_OVERLAP_CHARS = 1_200;
const RAG_SOURCE_LABEL_UPLOADED_REPORT = "uploaded_report_text";
const CANONICAL_RAG_QUERY_MAX_CHARS = 6_000;
const CANONICAL_RAG_CHUNK_TARGET_CHARS = 1_200;
const CANONICAL_RAG_MAX_QUERY_TOKENS = 96;
const CANONICAL_RAG_MAX_CHUNKS = 4;
const CANONICAL_RAG_MAX_CONTEXT_CHARS = 4_800;
const CANONICAL_RAG_DEFAULT_QUERY =
  "enneagram core profile type motivation fear instinct integration meta message communication feedback conflict decision leadership team coaching relationship strain levels centers of expression lines of development";
const CANONICAL_RAG_DEFAULT_KEYWORDS = [
  "strain profile",
  "instinct",
  "dominant instinct",
  "main type",
  "level of integration",
  "core motivation",
  "core fear",
  "centers of expression",
  "feedback",
  "conflict",
];
const CANONICAL_RAG_STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "that",
  "this",
  "your",
  "have",
  "into",
  "about",
  "over",
  "under",
  "between",
  "across",
  "while",
  "will",
  "would",
  "could",
  "should",
  "their",
  "there",
  "these",
  "those",
  "when",
  "where",
  "which",
  "what",
  "were",
  "been",
  "being",
  "them",
  "they",
  "than",
  "then",
  "only",
  "just",
  "also",
  "into",
  "each",
  "other",
  "more",
  "most",
  "less",
  "very",
  "much",
  "many",
  "some",
  "such",
  "used",
  "using",
  "user",
  "report",
]);
const CID_ARTIFACT_PATTERN = /\(\s*c\s*i\s*d\s*:\s*\d+\s*\)/gi;
const CID_INLINE_PATTERN = /\bC\s*I\s*D\s*:\s*\d+\b/gi;

const execFileAsync = promisify(execFile);
const HIDDEN_ANALYST_PROMPT = "Act like an enneagram analyst and identify all of the information necessary to populate the Enneagram Dashboard with the highest level of accuracy.";

const STRING_OR_NULL_SCHEMA = { type: ["string", "null"] };
const STRING_ARRAY_SCHEMA = { type: "array", items: STRING_OR_NULL_SCHEMA };
const LEVEL_SUMMARY_OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["level", "summary"],
  properties: {
    level: STRING_OR_NULL_SCHEMA,
    summary: STRING_OR_NULL_SCHEMA,
  },
};
const CENTER_EXPRESSION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["level", "mode", "impact"],
  properties: {
    level: STRING_OR_NULL_SCHEMA,
    mode: STRING_OR_NULL_SCHEMA,
    impact: STRING_OR_NULL_SCHEMA,
  },
};
const LINE_DEVELOPMENT_POINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "description"],
  properties: {
    type: STRING_OR_NULL_SCHEMA,
    description: STRING_OR_NULL_SCHEMA,
  },
};
const ATTACHED_JSON_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "client",
    "core_profile",
    "strain_profile",
    "centers_of_expression",
    "lines_of_development",
    "communication_dynamics",
    "feedback",
    "conflict_and_triggers",
    "decision_making",
    "leadership_and_management",
    "team_behaviour",
    "coaching_relationship",
  ],
  properties: {
    client: {
      type: "object",
      additionalProperties: false,
      required: ["name", "date"],
      properties: {
        name: STRING_OR_NULL_SCHEMA,
        date: STRING_OR_NULL_SCHEMA,
      },
    },
    core_profile: {
      type: "object",
      additionalProperties: false,
      required: [
        "type_number",
        "type_name",
        "core_motivation",
        "core_fear",
        "instinctual_subtype",
        "level_of_integration",
        "meta_message",
      ],
      properties: {
        type_number: {
          anyOf: [{ type: "number" }, { type: "string" }, { type: "null" }],
        },
        type_name: STRING_OR_NULL_SCHEMA,
        core_motivation: STRING_OR_NULL_SCHEMA,
        core_fear: STRING_OR_NULL_SCHEMA,
        instinctual_subtype: {
          type: "object",
          additionalProperties: false,
          required: ["type", "description"],
          properties: {
            type: STRING_OR_NULL_SCHEMA,
            description: STRING_OR_NULL_SCHEMA,
          },
        },
        level_of_integration: STRING_OR_NULL_SCHEMA,
        meta_message: STRING_OR_NULL_SCHEMA,
      },
    },
    strain_profile: {
      type: "object",
      additionalProperties: false,
      required: [
        "overall",
        "vocational",
        "interpersonal",
        "environmental",
        "physical",
        "psychological",
        "happiness",
      ],
      properties: {
        overall: LEVEL_SUMMARY_OBJECT_SCHEMA,
        vocational: LEVEL_SUMMARY_OBJECT_SCHEMA,
        interpersonal: LEVEL_SUMMARY_OBJECT_SCHEMA,
        environmental: LEVEL_SUMMARY_OBJECT_SCHEMA,
        physical: LEVEL_SUMMARY_OBJECT_SCHEMA,
        psychological: LEVEL_SUMMARY_OBJECT_SCHEMA,
        happiness: LEVEL_SUMMARY_OBJECT_SCHEMA,
      },
    },
    centers_of_expression: {
      type: "object",
      additionalProperties: false,
      required: ["feeling", "action", "thinking"],
      properties: {
        feeling: CENTER_EXPRESSION_SCHEMA,
        action: CENTER_EXPRESSION_SCHEMA,
        thinking: CENTER_EXPRESSION_SCHEMA,
      },
    },
    lines_of_development: {
      type: "object",
      additionalProperties: false,
      required: ["release_point", "stretch_point", "wing_influence"],
      properties: {
        release_point: LINE_DEVELOPMENT_POINT_SCHEMA,
        stretch_point: LINE_DEVELOPMENT_POINT_SCHEMA,
        wing_influence: STRING_ARRAY_SCHEMA,
      },
    },
    communication_dynamics: {
      type: "object",
      additionalProperties: false,
      required: ["verbal_style", "language_cues", "listening_habits", "body_language"],
      properties: {
        verbal_style: STRING_OR_NULL_SCHEMA,
        language_cues: STRING_OR_NULL_SCHEMA,
        listening_habits: STRING_OR_NULL_SCHEMA,
        body_language: STRING_OR_NULL_SCHEMA,
      },
    },
    feedback: {
      type: "object",
      additionalProperties: false,
      required: ["giving", "receiving"],
      properties: {
        giving: STRING_ARRAY_SCHEMA,
        receiving: STRING_ARRAY_SCHEMA,
      },
    },
    conflict_and_triggers: {
      type: "object",
      additionalProperties: false,
      required: ["primary_triggers", "behavior_when_triggered", "what_others_should_do"],
      properties: {
        primary_triggers: STRING_ARRAY_SCHEMA,
        behavior_when_triggered: STRING_ARRAY_SCHEMA,
        what_others_should_do: STRING_ARRAY_SCHEMA,
      },
    },
    decision_making: {
      type: "object",
      additionalProperties: false,
      required: ["approach", "drawbacks", "impact_of_strain"],
      properties: {
        approach: STRING_OR_NULL_SCHEMA,
        drawbacks: STRING_OR_NULL_SCHEMA,
        impact_of_strain: STRING_OR_NULL_SCHEMA,
      },
    },
    leadership_and_management: {
      type: "object",
      additionalProperties: false,
      required: [
        "goal_setting",
        "planning",
        "task_completion",
        "delegation",
        "performance_management",
        "motivation",
        "strategic_leadership",
      ],
      properties: {
        goal_setting: STRING_OR_NULL_SCHEMA,
        planning: STRING_OR_NULL_SCHEMA,
        task_completion: STRING_OR_NULL_SCHEMA,
        delegation: STRING_OR_NULL_SCHEMA,
        performance_management: STRING_OR_NULL_SCHEMA,
        motivation: STRING_OR_NULL_SCHEMA,
        strategic_leadership: STRING_OR_NULL_SCHEMA,
      },
    },
    team_behaviour: {
      type: "object",
      additionalProperties: false,
      required: ["ideal_role", "forming", "storming", "norming", "performing"],
      properties: {
        ideal_role: STRING_OR_NULL_SCHEMA,
        forming: STRING_ARRAY_SCHEMA,
        storming: STRING_ARRAY_SCHEMA,
        norming: STRING_ARRAY_SCHEMA,
        performing: STRING_ARRAY_SCHEMA,
      },
    },
    coaching_relationship: {
      type: "object",
      additionalProperties: false,
      required: ["needs", "challenges", "opportunities"],
      properties: {
        needs: STRING_ARRAY_SCHEMA,
        challenges: STRING_ARRAY_SCHEMA,
        opportunities: STRING_ARRAY_SCHEMA,
      },
    },
  },
};

const ATTACHED_JSON_SYSTEM_PROMPT = `
You are an expert Enneagram coach and data analyst.
${HIDDEN_ANALYST_PROMPT}
I will provide repaired HTML report text extracted from an iEQ9 Individual Professional Enneagram Report.

Your task is to parse the repaired HTML report content and output a structured JSON object.
Extract the required JSON strictly from the following repaired HTML report.

CRITICAL INSTRUCTIONS:
1. Do not hallucinate data. If a metric is missing, use null or an empty string.
2. Keep summaries concise (1-2 sentences max per field).
3. Normalize obvious OCR artifacts before emitting JSON:
   - Merge split words like "sur v ive", "di fficult", and "d i r e c t i o n".
   - Fix accidental spaces around punctuation while preserving original meaning.
4. Preserve table meaning exactly as represented in HTML table cells (td/th).
5. Do not infer from image layout; use only provided repaired text.
4. Follow this targeted extraction guidance for higher-accuracy section capture:
   - Act like an enneagram expert and identify and parse the following sections and the most relevant copy specific to the current report.
   - Core Enneagram Type: page 8
   - 27 Subtypes & Instincts: page 10
   - Centers of Expression: page 12 and 13. In the dashboard, change the number bar chart to Low, Medium, High.
   - Self-Awareness & Integration: page 16 and 17
   - Strain Profile (in the dashboard, change the number bar chart to Low, Medium, High):
     - Overall Strain: page 18
     - Vocational: page 20
     - Environmental: page 20
     - Physical: page 21
     - Interpersonal: page 21
     - Psychological: page 22
     - Happiness: page 22
   - Communication: page 24
   - Feedback Guide: page 28 and 29
   - Development Exercise: page 7, 11, 13, 17, 19, 31, 36, 28
6. Output ONLY valid JSON matching this structure:
{
  "client": { "name": "String", "date": "String" },
  "core_profile": {
    "type_number": "Number",
    "type_name": "String",
    "core_motivation": "String",
    "core_fear": "String",
    "instinctual_subtype": { "type": "String", "description": "String" },
    "level_of_integration": "String",
    "meta_message": "String"
  },
  "strain_profile": {
    "overall": { "level": "String", "summary": "String" },
    "vocational": { "level": "String", "summary": "String" },
    "interpersonal": { "level": "String", "summary": "String" },
    "environmental": { "level": "String", "summary": "String" },
    "physical": { "level": "String", "summary": "String" },
    "psychological": { "level": "String", "summary": "String" },
    "happiness": { "level": "String", "summary": "String" }
  },
  "centers_of_expression": {
    "feeling": { "level": "String", "mode": "String", "impact": "String" },
    "action": { "level": "String", "mode": "String", "impact": "String" },
    "thinking": { "level": "String", "mode": "String", "impact": "String" }
  },
  "lines_of_development": {
    "release_point": { "type": "String", "description": "String" },
    "stretch_point": { "type": "String", "description": "String" },
    "wing_influence": ["String"]
  },
  "communication_dynamics": {
    "verbal_style": "String",
    "language_cues": "String",
    "listening_habits": "String",
    "body_language": "String"
  },
  "feedback": { "giving": ["String"], "receiving": ["String"] },
  "conflict_and_triggers": {
    "primary_triggers": ["String"],
    "behavior_when_triggered": ["String"],
    "what_others_should_do": ["String"]
  },
  "decision_making": {
    "approach": "String",
    "drawbacks": "String",
    "impact_of_strain": "String"
  },
  "leadership_and_management": {
    "goal_setting": "String",
    "planning": "String",
    "task_completion": "String",
    "delegation": "String",
    "performance_management": "String",
    "motivation": "String",
    "strategic_leadership": "String"
  },
  "team_behaviour": {
    "ideal_role": "String",
    "forming": ["String"],
    "storming": ["String"],
    "norming": ["String"],
    "performing": ["String"]
  },
  "coaching_relationship": {
    "needs": ["String"],
    "challenges": ["String"],
    "opportunities": ["String"]
  }
}
`.trim();

const AGENTIC_OCR_REPAIR_SYSTEM_PROMPT =
  "You are an OCR repair agent. Fix broken font kerning (e.g., 'Sum m ary'), un-merge squashed words, and fix broken HTML table tags. Do NOT alter facts. Return only the repaired text.";

function normalizeWhitespace(value) {
  return stripCidArtifacts(String(value || "")).replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
}

function countCidArtifacts(value) {
  const source = String(value || "");
  const groupedTokens = source.match(/\(\s*c\s*i\s*d\s*:\s*\d+\s*\)/gi) || [];
  const inlineTokens = source.match(/\bC\s*I\s*D\s*:\s*\d+\b/gi) || [];
  return groupedTokens.length + inlineTokens.length;
}

function stripCidArtifacts(value) {
  return String(value || "")
    .replace(CID_ARTIFACT_PATTERN, " ")
    .replace(CID_INLINE_PATTERN, " ");
}

function sanitizePdfExtractedText(value, options = {}) {
  const preserveLineBreaks = options?.preserveLineBreaks !== false;
  const withoutCid = stripCidArtifacts(value);
  if (!preserveLineBreaks) {
    return withoutCid
      .replace(/\u0000/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return withoutCid
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stringOrNull(value) {
  const normalized = normalizeWhitespace(value);
  return normalized.length ? normalized : null;
}

function normalizeOptionalMetadataValue(value) {
  const normalized = stringOrNull(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (
    lowered === "not detected" ||
    lowered.startsWith("not detected in assigned pdf") ||
    lowered.startsWith("not detected in parsed pdf text") ||
    lowered === "unknown" ||
    lowered === "n/a" ||
    lowered === "na" ||
    lowered === "none" ||
    lowered === "null"
  ) {
    return null;
  }
  return normalized;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactLines(lines) {
  return asArray(lines)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function tokenizeForCanonicalRag(text, maxTokens = CANONICAL_RAG_MAX_QUERY_TOKENS) {
  const rawTokens = normalizeWhitespace(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const tokens = [];
  const seen = new Set();
  for (const token of rawTokens) {
    if (token.length < 3) continue;
    if (CANONICAL_RAG_STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= maxTokens) break;
  }
  return tokens;
}

function splitCanonicalReferenceIntoChunks(sourceText, chunkTargetChars = CANONICAL_RAG_CHUNK_TARGET_CHARS) {
  const targetChars = Number.isFinite(Number(chunkTargetChars)) && Number(chunkTargetChars) > 100
    ? Math.floor(Number(chunkTargetChars))
    : CANONICAL_RAG_CHUNK_TARGET_CHARS;

  const paragraphs = String(sourceText || "")
    .split(/\n{2,}/)
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);

  const chunks = [];
  let currentChunk = "";
  for (const paragraphText of paragraphs) {
    let paragraph = paragraphText;
    while (paragraph.length > targetChars * 1.35) {
      let breakIndex = paragraph.lastIndexOf(" ", targetChars);
      if (breakIndex < Math.floor(targetChars * 0.65)) {
        breakIndex = targetChars;
      }
      const slice = paragraph.slice(0, breakIndex).trim();
      if (slice) {
        const nextChunk = currentChunk ? `${currentChunk}\n\n${slice}` : slice;
        if (nextChunk.length > targetChars && currentChunk) {
          chunks.push(currentChunk);
          currentChunk = slice;
        } else {
          currentChunk = nextChunk;
        }
      }
      paragraph = paragraph.slice(breakIndex).trim();
    }

    if (!paragraph) continue;
    const nextChunk = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
    if (nextChunk.length > targetChars && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = paragraph;
    } else {
      currentChunk = nextChunk;
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks
    .map((chunkText, index) => ({
      index,
      text: chunkText,
      tokenSet: new Set(tokenizeForCanonicalRag(chunkText, 240)),
    }))
    .filter((entry) => entry.text.length >= 60 && entry.tokenSet.size > 0);
}

function normalizeCanonicalKeywords(keywords) {
  const source = Array.isArray(keywords) && keywords.length > 0 ? keywords : CANONICAL_RAG_DEFAULT_KEYWORDS;
  const normalized = [];
  const seen = new Set();
  for (const entry of source) {
    const cleaned = normalizeWhitespace(entry).toLowerCase();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    normalized.push(cleaned);
  }
  return normalized;
}

function buildCanonicalRagQuery({ rawText, sourceFileName, keywords = CANONICAL_RAG_DEFAULT_KEYWORDS }) {
  const normalizedKeywords = normalizeCanonicalKeywords(keywords);
  const keywordPrefix = normalizedKeywords.length > 0
    ? normalizedKeywords.join(" ")
    : CANONICAL_RAG_DEFAULT_QUERY;
  const rawTextSnippet = normalizeWhitespace(rawText || "").slice(0, CANONICAL_RAG_QUERY_MAX_CHARS);
  if (rawTextSnippet) {
    return `${CANONICAL_RAG_DEFAULT_QUERY}\n${keywordPrefix}\n${rawTextSnippet}`;
  }
  const fileNameLabel = normalizeWhitespace(sourceFileName || "report.pdf");
  return `${CANONICAL_RAG_DEFAULT_QUERY}\n${keywordPrefix}\nsource file ${fileNameLabel}`;
}

function scoreCanonicalChunkAgainstKeywords({
  queryTokenSet,
  chunkTokenSet,
  keywordPhrases,
  chunkText,
}) {
  const safeQueryTokens = queryTokenSet instanceof Set ? queryTokenSet : new Set(asArray(queryTokenSet));
  const safeChunkTokens = chunkTokenSet instanceof Set ? chunkTokenSet : new Set(asArray(chunkTokenSet));
  if (safeQueryTokens.size === 0 || safeChunkTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of safeQueryTokens) {
    if (safeChunkTokens.has(token)) overlap += 1;
  }

  const coverage = overlap / safeQueryTokens.size;
  const density = overlap / Math.sqrt(Math.max(1, safeChunkTokens.size));
  const tokenScore = coverage * 0.7 + density * 0.3;

  const loweredChunk = String(chunkText || "").toLowerCase();
  const normalizedKeywordPhrases = normalizeCanonicalKeywords(keywordPhrases);
  const phraseHits = normalizedKeywordPhrases.reduce(
    (count, phrase) => count + (loweredChunk.includes(phrase) ? 1 : 0),
    0,
  );
  const phraseScore = normalizedKeywordPhrases.length > 0 ? phraseHits / normalizedKeywordPhrases.length : 0;

  return tokenScore * 0.65 + phraseScore * 0.35;
}

function selectCanonicalRagChunks({
  scoredChunks,
  maxChunks = CANONICAL_RAG_MAX_CHUNKS,
  maxContextChars = CANONICAL_RAG_MAX_CONTEXT_CHARS,
}) {
  const rankedChunks = Array.isArray(scoredChunks) ? [...scoredChunks] : [];
  const safeMaxChunks = Number.isFinite(Number(maxChunks)) && Number(maxChunks) > 0
    ? Math.floor(Number(maxChunks))
    : CANONICAL_RAG_MAX_CHUNKS;
  const safeMaxContextChars = Number.isFinite(Number(maxContextChars)) && Number(maxContextChars) > 0
    ? Math.floor(Number(maxContextChars))
    : CANONICAL_RAG_MAX_CONTEXT_CHARS;

  rankedChunks.sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = [];
  let consumedChars = 0;
  for (const chunk of rankedChunks) {
    if (selected.length >= safeMaxChunks) break;
    if (!chunk?.text) continue;
    if (chunk.score <= 0 && selected.length > 0) continue;
    if (consumedChars + chunk.text.length > safeMaxContextChars) continue;
    selected.push(chunk);
    consumedChars += chunk.text.length;
  }

  if (selected.length === 0 && rankedChunks.length > 0 && rankedChunks[0]?.text) {
    selected.push(rankedChunks[0]);
  }

  return selected;
}

function formatCanonicalRagContent(selectedChunks) {
  return asArray(selectedChunks)
    .filter((chunk) => stringOrNull(chunk?.text))
    .map((chunk, index) => `[Report Reference ${index + 1}] ${chunk.text}`)
    .join("\n\n");
}

function buildCanonicalRagContextFromText({
  rawText,
  sourceFileName,
  keywords = CANONICAL_RAG_DEFAULT_KEYWORDS,
  maxChunks = CANONICAL_RAG_MAX_CHUNKS,
  maxContextChars = CANONICAL_RAG_MAX_CONTEXT_CHARS,
}) {
  const sourceText = stringOrNull(rawText);
  if (!sourceText) {
    return {
      queryTokens: [],
      selectedChunks: [],
      content: "",
    };
  }

  const sourceChunks = splitCanonicalReferenceIntoChunks(sourceText, CANONICAL_RAG_CHUNK_TARGET_CHARS);
  if (!Array.isArray(sourceChunks) || sourceChunks.length === 0) {
    return {
      queryTokens: [],
      selectedChunks: [],
      content: "",
    };
  }

  const query = buildCanonicalRagQuery({ rawText: sourceText, sourceFileName, keywords });
  const queryTokens = tokenizeForCanonicalRag(query, CANONICAL_RAG_MAX_QUERY_TOKENS);
  const queryTokenSet = new Set(queryTokens);
  const scoredChunks = sourceChunks.map((chunk) => ({
    ...chunk,
    score: scoreCanonicalChunkAgainstKeywords({
      queryTokenSet,
      chunkTokenSet: chunk?.tokenSet,
      keywordPhrases: keywords,
      chunkText: chunk?.text,
    }),
  }));
  const selectedChunks = selectCanonicalRagChunks({
    scoredChunks,
    maxChunks,
    maxContextChars,
  });

  return {
    queryTokens,
    selectedChunks,
    content: formatCanonicalRagContent(selectedChunks),
  };
}

async function buildCanonicalRagContext(input, keywordsOrOptions, maybeOptions) {
  if (typeof input === "string") {
    const keywords = Array.isArray(keywordsOrOptions) ? keywordsOrOptions : CANONICAL_RAG_DEFAULT_KEYWORDS;
    const optionalConfig =
      !Array.isArray(keywordsOrOptions) && keywordsOrOptions && typeof keywordsOrOptions === "object"
        ? keywordsOrOptions
        : maybeOptions;
    const contextResult = buildCanonicalRagContextFromText({
      rawText: input,
      keywords,
      maxChunks: optionalConfig?.maxChunks,
      maxContextChars: optionalConfig?.maxContextChars,
    });
    return contextResult.content;
  }

  const options = input && typeof input === "object" ? input : {};
  const enabled = options?.enabled === true;
  const sourceText = stringOrNull(options?.rawText);
  const sourceFileName = options?.sourceFileName;
  const maxChunks = options?.maxChunks;
  const maxContextChars = options?.maxContextChars;
  const keywords = Array.isArray(options?.keywords) && options.keywords.length > 0
    ? options.keywords
    : CANONICAL_RAG_DEFAULT_KEYWORDS;

  if (!enabled) {
    return {
      enabled: false,
      available: false,
      reason: "disabled",
      source: RAG_SOURCE_LABEL_UPLOADED_REPORT,
      sourcePath: null,
      queryTokenCount: 0,
      retrievedChunkCount: 0,
      retrievedChars: 0,
      content: "",
    };
  }

  if (!sourceText) {
    return {
      enabled: true,
      available: false,
      reason: "no_document_text",
      source: RAG_SOURCE_LABEL_UPLOADED_REPORT,
      sourcePath: null,
      queryTokenCount: 0,
      retrievedChunkCount: 0,
      retrievedChars: 0,
      content: "",
    };
  }

  const contextResult = buildCanonicalRagContextFromText({
    rawText: sourceText,
    sourceFileName,
    keywords,
    maxChunks,
    maxContextChars,
  });

  if (!contextResult.content) {
    return {
      enabled: true,
      available: false,
      reason: "no_relevant_chunks",
      source: RAG_SOURCE_LABEL_UPLOADED_REPORT,
      sourcePath: null,
      queryTokenCount: contextResult.queryTokens.length,
      retrievedChunkCount: 0,
      retrievedChars: 0,
      content: "",
    };
  }

  console.log("[parsePdf] In-document RAG context retrieved.", {
    source: RAG_SOURCE_LABEL_UPLOADED_REPORT,
    queryTokenCount: contextResult.queryTokens.length,
    retrievedChunkCount: contextResult.selectedChunks.length,
    retrievedChars: contextResult.content.length,
    keywords: normalizeCanonicalKeywords(keywords).slice(0, 8),
  });

  return {
    enabled: true,
    available: true,
    reason: null,
    source: RAG_SOURCE_LABEL_UPLOADED_REPORT,
    sourcePath: null,
    queryTokenCount: contextResult.queryTokens.length,
    retrievedChunkCount: contextResult.selectedChunks.length,
    retrievedChars: contextResult.content.length,
    content: contextResult.content,
  };
}

function buildCanonicalRagPromptPrefix(ragContext) {
  const ragText = stringOrNull(ragContext?.content);
  if (!ragContext?.enabled || !ragContext?.available || !ragText) return "";
  return [
    "Retrieved report excerpts from the uploaded document:",
    ragText,
    "",
    "Use these excerpts as supporting context while keeping report-derived facts primary.",
    "Do not override explicit facts from the uploaded report.",
  ].join("\n");
}

function summarizeCanonicalRagDiagnostics(ragContext) {
  return {
    enabled: Boolean(ragContext?.enabled),
    available: Boolean(ragContext?.available),
    reason: stringOrNull(ragContext?.reason),
    source: stringOrNull(ragContext?.source) || RAG_SOURCE_LABEL_UPLOADED_REPORT,
    sourcePath: stringOrNull(ragContext?.sourcePath),
    queryTokenCount: Number.isFinite(Number(ragContext?.queryTokenCount)) ? Number(ragContext.queryTokenCount) : 0,
    retrievedChunkCount: Number.isFinite(Number(ragContext?.retrievedChunkCount))
      ? Number(ragContext.retrievedChunkCount)
      : 0,
    retrievedChars: Number.isFinite(Number(ragContext?.retrievedChars)) ? Number(ragContext.retrievedChars) : 0,
  };
}

function normalizeExtractionLearningContext(context) {
  if (!context || typeof context !== "object") {
    return {
      modelVersion: null,
      status: "not_provided",
      reason: "not_provided",
      generatedAt: null,
      training: {
        scannedRowCount: 0,
        trainingSampleCount: 0,
      },
      hintCount: 0,
      promptHintText: "",
    };
  }

  const training = context?.training && typeof context.training === "object" ? context.training : {};
  const normalizedHintCount = Number.isFinite(Number(context?.hintCount))
    ? Math.max(0, Math.floor(Number(context.hintCount)))
    : stringOrNull(context?.promptHintText)
      ? 1
      : 0;

  return {
    modelVersion: stringOrNull(context?.modelVersion),
    status: stringOrNull(context?.status) || "unknown",
    reason: stringOrNull(context?.reason),
    generatedAt: stringOrNull(context?.generatedAt),
    training: {
      scannedRowCount: Number.isFinite(Number(training?.scannedRowCount))
        ? Math.max(0, Math.floor(Number(training.scannedRowCount)))
        : 0,
      trainingSampleCount: Number.isFinite(Number(training?.trainingSampleCount))
        ? Math.max(0, Math.floor(Number(training.trainingSampleCount)))
        : 0,
    },
    hintCount: normalizedHintCount,
    promptHintText: stringOrNull(context?.promptHintText) || "",
  };
}

function buildExtractionLearningPromptPrefix(extractionLearningContext) {
  const normalizedContext = normalizeExtractionLearningContext(extractionLearningContext);
  const hintText = stringOrNull(normalizedContext?.promptHintText);
  if (normalizedContext?.status !== "active" || !hintText) return "";

  return [
    "Extraction-stage priors from reviewed reports (soft guidance only):",
    hintText,
    "",
    "Use these priors only as tie-breakers when report text is ambiguous.",
    "Never override explicit facts from the uploaded report.",
  ].join("\n");
}

function summarizeExtractionLearningDiagnostics(extractionLearningContext) {
  const normalizedContext = normalizeExtractionLearningContext(extractionLearningContext);
  return {
    modelVersion: stringOrNull(normalizedContext?.modelVersion),
    status: stringOrNull(normalizedContext?.status) || "unknown",
    reason: stringOrNull(normalizedContext?.reason),
    generatedAt: stringOrNull(normalizedContext?.generatedAt),
    scannedRowCount: Number.isFinite(Number(normalizedContext?.training?.scannedRowCount))
      ? Number(normalizedContext.training.scannedRowCount)
      : 0,
    trainingSampleCount: Number.isFinite(Number(normalizedContext?.training?.trainingSampleCount))
      ? Number(normalizedContext.training.trainingSampleCount)
      : 0,
    hintCount: Number.isFinite(Number(normalizedContext?.hintCount))
      ? Number(normalizedContext.hintCount)
      : 0,
  };
}

function normalizeLevelLabel(level) {
  const normalized = String(level || "").trim().toUpperCase();
  if (normalized === "HIGH") return "High";
  if (normalized === "MEDIUM" || normalized === "MODERATE") return "Medium";
  if (normalized === "LOW") return "Low";
  return null;
}

function normalizeLevelUpper(level) {
  const normalized = normalizeLevelLabel(level);
  return normalized ? normalized.toUpperCase() : null;
}

function levelLabelToVisualScore(level) {
  const normalized = normalizeLevelLabel(level);
  if (normalized === "High") return 100;
  if (normalized === "Medium") return 50;
  if (normalized === "Low") return 0;
  return null;
}

function normalizeInstinctualVariant(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "sx" || normalized.includes("one-on-one") || normalized.includes("sexual")) return "sx";
  if (normalized === "so" || normalized.includes("social")) return "so";
  if (normalized === "sp" || normalized.includes("self-preservation") || normalized.includes("self preservation")) return "sp";
  return null;
}

function normalizeTypeNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Math.floor(numeric);
  return normalized >= 1 && normalized <= 9 ? normalized : null;
}

function normalizeTypeNameForCompare(value) {
  return normalizeWhitespace(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const TYPE_NAME_INFERENCE_KEYWORDS = [
  { type: 1, keywords: ["principled reformer", "reformer", "perfectionist"] },
  { type: 2, keywords: ["caring helper", "helper", "giver"] },
  { type: 3, keywords: ["driven achiever", "achiever", "performer"] },
  { type: 4, keywords: ["reflective individualist", "individualist", "romantic"] },
  { type: 5, keywords: ["quiet investigator", "investigator", "observer"] },
  { type: 6, keywords: ["committed loyalist", "loyalist", "skeptic"] },
  { type: 7, keywords: ["energetic enthusiast", "enthusiast", "epicure"] },
  { type: 8, keywords: ["active controller", "challenger", "controller", "protector"] },
  { type: 9, keywords: ["steady peacemaker", "peacemaker", "mediator"] },
];

function inferTypeNumberFromTypeName(typeName) {
  const normalized = normalizeTypeNameForCompare(typeName);
  if (!normalized || isPlaceholderTypeName(normalized)) return null;

  const explicitTypeMatch = normalized.match(/\btype\s*([1-9])\b/);
  if (explicitTypeMatch?.[1]) {
    return normalizeTypeNumber(explicitTypeMatch[1]);
  }

  for (const entry of TYPE_NAME_INFERENCE_KEYWORDS) {
    for (const keyword of entry.keywords) {
      const normalizedKeyword = normalizeTypeNameForCompare(keyword);
      if (!normalizedKeyword) continue;
      if (normalized === normalizedKeyword) return entry.type;
      if (normalized.startsWith(`${normalizedKeyword} `)) return entry.type;
      if (normalized.includes(` ${normalizedKeyword} `)) return entry.type;
      if (normalized.endsWith(` ${normalizedKeyword}`)) return entry.type;
    }
  }

  return null;
}

function isPlaceholderTypeName(value) {
  const normalized = normalizeTypeNameForCompare(value);
  if (!normalized) return true;
  if (normalized === "unknown" || normalized === "not detected") return true;
  if (normalized === "copyright" || normalized === "all rights reserved") return true;
  if (normalized.includes("copyright")) return true;
  return false;
}

function normalizeIntegrationValue(value) {
  const normalized = normalizeWhitespace(value || "");
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "high") return "High";
  if (lowered === "moderate" || lowered === "medium") return "Moderate";
  if (lowered === "low") return "Low";
  return normalized;
}

function normalizeNonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

function normalizeNonNegativeNumber(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (!Number.isFinite(Number(precision)) || Number(precision) < 0) return numeric;
  return Number(numeric.toFixed(Number(precision)));
}

function resolveNoiseSeverityFromDensity(densityPer10kChars) {
  if (!Number.isFinite(Number(densityPer10kChars)) || Number(densityPer10kChars) < 0) return "unknown";
  const normalizedDensity = Number(densityPer10kChars);
  if (normalizedDensity < 1) return "minimal";
  if (normalizedDensity < 5) return "low";
  if (normalizedDensity < 20) return "moderate";
  return "high";
}

function normalizeNoiseSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "unknown" ||
    normalized === "minimal" ||
    normalized === "low" ||
    normalized === "moderate" ||
    normalized === "high"
  ) {
    return normalized;
  }
  return null;
}

function normalizeTextNoiseMetrics(value) {
  if (!value || typeof value !== "object") return null;

  const controlNoiseChars = normalizeNonNegativeInteger(value?.controlNoiseChars);
  const replacementChars = normalizeNonNegativeInteger(value?.replacementChars);
  const totalNoiseChars = normalizeNonNegativeInteger(value?.totalNoiseChars);
  const totalChars = normalizeNonNegativeInteger(value?.totalChars);
  const pagesWithControlNoise = normalizeNonNegativeInteger(value?.pagesWithControlNoise);
  const pageCount = normalizeNonNegativeInteger(value?.pageCount);
  const controlNoisePer10kChars = normalizeNonNegativeNumber(value?.controlNoisePer10kChars, 2);
  const score = normalizeNonNegativeInteger(value?.score);
  const providedSeverity = normalizeNoiseSeverity(value?.severity);

  const derivedTotalNoiseChars =
    totalNoiseChars != null
      ? totalNoiseChars
      : normalizeNonNegativeInteger(
          (controlNoiseChars || 0) + (replacementChars || 0),
        );
  const derivedControlNoisePer10kChars =
    controlNoisePer10kChars != null
      ? controlNoisePer10kChars
      : totalChars > 0 && derivedTotalNoiseChars != null
        ? normalizeNonNegativeNumber((derivedTotalNoiseChars / totalChars) * 10000, 2)
        : 0;
  const derivedScore =
    score != null
      ? Math.max(0, Math.min(100, score))
      : derivedControlNoisePer10kChars != null
        ? Math.max(0, Math.min(100, Math.round(derivedControlNoisePer10kChars)))
        : 0;
  const resolvedSeverity = providedSeverity || resolveNoiseSeverityFromDensity(derivedControlNoisePer10kChars);

  const hasSignal =
    controlNoiseChars != null ||
    replacementChars != null ||
    derivedTotalNoiseChars != null ||
    totalChars != null ||
    pagesWithControlNoise != null ||
    pageCount != null ||
    derivedControlNoisePer10kChars != null ||
    score != null ||
    providedSeverity != null;
  if (!hasSignal) return null;

  return {
    score: derivedScore,
    severity: resolvedSeverity || "unknown",
    controlNoiseChars: controlNoiseChars ?? 0,
    replacementChars: replacementChars ?? 0,
    totalNoiseChars: derivedTotalNoiseChars ?? 0,
    totalChars: totalChars ?? 0,
    controlNoisePer10kChars: derivedControlNoisePer10kChars ?? 0,
    pagesWithControlNoise: pagesWithControlNoise ?? 0,
    pageCount: pageCount ?? 0,
  };
}

function hasAnyFiniteScore(scoreMap) {
  if (!scoreMap || typeof scoreMap !== "object") return false;
  return Object.values(scoreMap).some((value) => value != null && Number.isFinite(Number(value)));
}

function buildTypeScoresFromPrimaryType(primaryType) {
  const normalizedPrimaryType = normalizeTypeNumber(primaryType);
  return Object.fromEntries(
    Array.from({ length: 9 }, (_, idx) => [`type${idx + 1}`, normalizedPrimaryType === idx + 1 ? 100 : null]),
  );
}

function buildInstinctScoresFromVariant(instinctualVariant) {
  const normalized = normalizeInstinctualVariant(instinctualVariant);
  return {
    sexual: normalized === "sx" ? 100 : null,
    social: normalized === "so" ? 100 : null,
    selfPreservation: normalized === "sp" ? 100 : null,
  };
}

function serializeObject(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

function createSectionEntry(sectionId, sectionTitle, content) {
  const fullText = normalizeWhitespace(content || "");
  if (!fullText) return null;
  return {
    sectionId,
    sectionTitle,
    pageStart: null,
    pageEnd: null,
    summary: fullText.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").trim() || fullText,
    fullText,
  };
}

function buildSectionsFromAttached(structured) {
  const client = structured?.client || {};
  const core = structured?.core_profile || {};
  const strain = structured?.strain_profile || {};
  const centers = structured?.centers_of_expression || {};
  const lines = structured?.lines_of_development || {};
  const communication = structured?.communication_dynamics || {};
  const feedback = structured?.feedback || {};
  const conflict = structured?.conflict_and_triggers || {};
  const decision = structured?.decision_making || {};
  const leadership = structured?.leadership_and_management || {};
  const team = structured?.team_behaviour || {};
  const coaching = structured?.coaching_relationship || {};

  const entries = [
    createSectionEntry(
      "core_profile",
      "Core Profile",
      compactLines([
        `Client: ${stringOrNull(client?.name) || "Not detected"}`,
        `Date: ${stringOrNull(client?.date) || "Not detected"}`,
        `Type: ${stringOrNull(core?.type_number) || "Not detected"} ${stringOrNull(core?.type_name) || ""}`.trim(),
        `Core Motivation: ${stringOrNull(core?.core_motivation) || "Not detected"}`,
        `Core Fear: ${stringOrNull(core?.core_fear) || "Not detected"}`,
        `Instinctual Subtype: ${stringOrNull(core?.instinctual_subtype?.type) || "Not detected"}${stringOrNull(core?.instinctual_subtype?.description) ? ` — ${stringOrNull(core?.instinctual_subtype?.description)}` : ""}`,
        `Integration: ${stringOrNull(core?.level_of_integration) || "Not detected"}`,
        `Meta Message: ${stringOrNull(core?.meta_message) || "Not detected"}`,
      ]),
    ),
    createSectionEntry(
      "strain_profile",
      "Strain Profile",
      compactLines([
        `Overall: ${stringOrNull(strain?.overall?.level) || "Not detected"} — ${stringOrNull(strain?.overall?.summary) || "Not detected"}`,
        `Vocational: ${stringOrNull(strain?.vocational?.level) || "Not detected"} — ${stringOrNull(strain?.vocational?.summary) || "Not detected"}`,
        `Interpersonal: ${stringOrNull(strain?.interpersonal?.level) || "Not detected"} — ${stringOrNull(strain?.interpersonal?.summary) || "Not detected"}`,
        `Environmental: ${stringOrNull(strain?.environmental?.level) || "Not detected"} — ${stringOrNull(strain?.environmental?.summary) || "Not detected"}`,
        `Physical: ${stringOrNull(strain?.physical?.level) || "Not detected"} — ${stringOrNull(strain?.physical?.summary) || "Not detected"}`,
        `Psychological: ${stringOrNull(strain?.psychological?.level) || "Not detected"} — ${stringOrNull(strain?.psychological?.summary) || "Not detected"}`,
        `Happiness: ${stringOrNull(strain?.happiness?.level) || "Not detected"} — ${stringOrNull(strain?.happiness?.summary) || "Not detected"}`,
      ]),
    ),
    createSectionEntry(
      "centers_of_expression",
      "Centers of Expression",
      compactLines([
        `Action: ${stringOrNull(centers?.action?.level) || "Not detected"} | Mode: ${stringOrNull(centers?.action?.mode) || "Not detected"} | Impact: ${stringOrNull(centers?.action?.impact) || "Not detected"}`,
        `Feeling: ${stringOrNull(centers?.feeling?.level) || "Not detected"} | Mode: ${stringOrNull(centers?.feeling?.mode) || "Not detected"} | Impact: ${stringOrNull(centers?.feeling?.impact) || "Not detected"}`,
        `Thinking: ${stringOrNull(centers?.thinking?.level) || "Not detected"} | Mode: ${stringOrNull(centers?.thinking?.mode) || "Not detected"} | Impact: ${stringOrNull(centers?.thinking?.impact) || "Not detected"}`,
      ]),
    ),
    createSectionEntry(
      "lines_of_development",
      "Lines of Development",
      compactLines([
        `Release Point: ${stringOrNull(lines?.release_point?.type) || "Not detected"} — ${stringOrNull(lines?.release_point?.description) || "Not detected"}`,
        `Stretch Point: ${stringOrNull(lines?.stretch_point?.type) || "Not detected"} — ${stringOrNull(lines?.stretch_point?.description) || "Not detected"}`,
        `Wing Influence: ${asArray(lines?.wing_influence).map((entry) => normalizeWhitespace(entry)).filter(Boolean).join("; ") || "Not detected"}`,
      ]),
    ),
    createSectionEntry("communication_dynamics", "Communication Dynamics", serializeObject(communication)),
    createSectionEntry("feedback", "Feedback", serializeObject(feedback)),
    createSectionEntry("conflict_and_triggers", "Conflict and Triggers", serializeObject(conflict)),
    createSectionEntry("decision_making", "Decision Making", serializeObject(decision)),
    createSectionEntry("leadership_and_management", "Leadership and Management", serializeObject(leadership)),
    createSectionEntry("team_behaviour", "Team Behaviour", serializeObject(team)),
    createSectionEntry("coaching_relationship", "Coaching Relationship", serializeObject(coaching)),
  ];

  return entries.filter(Boolean);
}

function buildOverridePages(rawText, pageCount) {
  const text = normalizeWhitespace(rawText || "");
  const count = Number.isFinite(Number(pageCount)) && Number(pageCount) > 0 ? Math.floor(Number(pageCount)) : 1;
  return Array.from({ length: count }, (_, index) => ({
    pageNumber: index + 1,
    extractedText: index === 0 ? text : "",
  }));
}

function normalizePagesOverride(pages) {
  const candidates = asArray(pages)
    .map((page, index) => {
      const pageNumber = Number.isFinite(Number(page?.pageNumber))
        ? Math.max(1, Math.floor(Number(page.pageNumber)))
        : index + 1;
      return {
        pageNumber,
        extractedText: sanitizePdfExtractedText(page?.extractedText, { preserveLineBreaks: true }),
      };
    })
    .filter((page) => Number.isFinite(page.pageNumber) && page.pageNumber > 0);

  if (!candidates.length) return [];

  const pageMap = new Map();
  candidates.forEach((page) => {
    const key = Number(page.pageNumber);
    const current = pageMap.get(key);
    if (!current) {
      pageMap.set(key, page);
      return;
    }
    if (!stringOrNull(current?.extractedText) && stringOrNull(page?.extractedText)) {
      pageMap.set(key, page);
    }
  });

  return Array.from(pageMap.values()).sort((a, b) => a.pageNumber - b.pageNumber);
}

function buildRawTextFromPages(pages, options = {}) {
  const withPageMarkers = Boolean(options?.withPageMarkers);
  return asArray(pages)
    .map((page, index) => {
      const pageNumber = Number.isFinite(Number(page?.pageNumber)) ? Number(page.pageNumber) : index + 1;
      const text = normalizeWhitespace(page?.extractedText || "");
      if (!text) return "";
      if (!withPageMarkers) return text;
      return `[Page ${pageNumber}]\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function buildParseCoverage({
  parsedPages,
  detectedTotalPages,
  minExpectedPages,
}) {
  const normalizedParsedPages = Number.isFinite(Number(parsedPages)) && Number(parsedPages) >= 0
    ? Math.floor(Number(parsedPages))
    : null;
  const normalizedDetectedTotalPages = Number.isFinite(Number(detectedTotalPages)) && Number(detectedTotalPages) > 0
    ? Math.floor(Number(detectedTotalPages))
    : null;
  const normalizedMinExpectedPages = Number.isFinite(Number(minExpectedPages)) && Number(minExpectedPages) > 0
    ? Math.floor(Number(minExpectedPages))
    : null;

  const coverageTarget = normalizedDetectedTotalPages || normalizedMinExpectedPages || null;
  const isCoverageComplete = coverageTarget != null
    ? (normalizedParsedPages != null && normalizedParsedPages >= coverageTarget)
    : Boolean(normalizedParsedPages != null && normalizedParsedPages > 0);

  return {
    parsedPages: normalizedParsedPages,
    detectedTotalPages: normalizedDetectedTotalPages,
    minExpectedPages: normalizedMinExpectedPages,
    isCoverageComplete,
  };
}

function buildVerificationSummary(verification) {
  if (!verification || typeof verification !== "object") {
    return {
      available: false,
      mismatchCount: 0,
      criticalMismatchCount: 0,
      criticalMismatchKeys: [],
    };
  }

  return {
    available: Boolean(verification.available),
    mismatchCount: Number.isFinite(Number(verification.mismatchCount)) ? Number(verification.mismatchCount) : 0,
    criticalMismatchCount: Number.isFinite(Number(verification.criticalMismatchCount))
      ? Number(verification.criticalMismatchCount)
      : 0,
    criticalMismatchKeys: Array.isArray(verification.criticalMismatchKeys)
      ? verification.criticalMismatchKeys.filter(Boolean)
      : [],
  };
}

function buildAzurePreflightStatus({
  endpoint,
  deployment,
  apiKey,
  docIntelEndpoint,
  docIntelKey,
  llamaCloudApiKey,
  requireDocIntel = true,
  requireLlama = true,
}) {
  const missingEnvVars = [];
  if (!endpoint) missingEnvVars.push("AZURE_OPENAI_ENDPOINT");
  if (!deployment) missingEnvVars.push("AZURE_OPENAI_DEPLOYMENT_NAME");
  if (!apiKey) missingEnvVars.push("AZURE_OPENAI_API_KEY");
  if (requireLlama && !llamaCloudApiKey) missingEnvVars.push("LLAMA_CLOUD_API_KEY");
  if (requireDocIntel) {
    if (!docIntelEndpoint) missingEnvVars.push("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
    if (!docIntelKey) missingEnvVars.push("AZURE_DOCUMENT_INTELLIGENCE_KEY");
  }
  return {
    isReady: missingEnvVars.length === 0,
    missingEnvVars,
  };
}

function buildDocIntelPreflightStatus({ endpoint, apiKey }) {
  return buildAzurePreflightStatus({
    endpoint: "__openai_not_required__",
    deployment: "__openai_not_required__",
    apiKey: "__openai_not_required__",
    docIntelEndpoint: endpoint,
    docIntelKey: apiKey,
    requireDocIntel: true,
    requireLlama: false,
  });
}

function partitionMissingAzureEnvVars(missingEnvVars) {
  const normalizedMissing = Array.isArray(missingEnvVars) ? missingEnvVars : [];
  return {
    openAi: normalizedMissing.filter((envName) => String(envName).startsWith("AZURE_OPENAI_")),
    docIntel: normalizedMissing.filter((envName) => String(envName).startsWith("AZURE_DOCUMENT_INTELLIGENCE_")),
    llama: normalizedMissing.filter((envName) => String(envName).startsWith("LLAMA_")),
  };
}

function buildParsePreflightDiagnostics({
  missingOpenAiEnvVars,
  missingDocIntelEnvVars,
  missingLlamaEnvVars,
  docIntelRequiredForRun,
  llamaRequiredForRun,
}) {
  const openAiMissing = Array.isArray(missingOpenAiEnvVars) ? missingOpenAiEnvVars : [];
  const docIntelMissing = Array.isArray(missingDocIntelEnvVars) ? missingDocIntelEnvVars : [];
  const llamaMissing = Array.isArray(missingLlamaEnvVars) ? missingLlamaEnvVars : [];

  return {
    missingEnvVars: openAiMissing,
    hasAzureOpenAiConfig: openAiMissing.length === 0,
    missingDocIntelEnvVars: docIntelMissing,
    hasAzureDocIntelConfig: docIntelRequiredForRun ? docIntelMissing.length === 0 : true,
    missingLlamaEnvVars: llamaMissing,
    hasLlamaCloudConfig: llamaRequiredForRun ? llamaMissing.length === 0 : true,
  };
}

function normalizeAzureEnvVar(value, options = {}) {
  const normalized = String(value || "").replace(/['"]/g, "").trim();
  if (options?.stripTrailingSlash) {
    return normalized.replace(/\/$/, "");
  }
  return normalized;
}

function buildPrimaryTypePageTokens(primaryType) {
  const numericType = normalizeTypeNumber(primaryType);
  if (numericType == null) return [];
  return [`type ${numericType}`, `enneagram type ${numericType}`, `ennea ${numericType}`];
}

function resolveFieldPageHits(pages, candidateValues) {
  const snapshots = asArray(pages);
  const candidates = asArray(candidateValues)
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length >= 2);
  if (!snapshots.length || !candidates.length) return [];

  const hits = new Set();
  for (const page of snapshots) {
    const pageNumber = Number.isFinite(Number(page?.pageNumber)) ? Math.floor(Number(page.pageNumber)) : null;
    if (!pageNumber) continue;
    const pageText = normalizeWhitespace(page?.extractedText || "").toLowerCase();
    if (!pageText) continue;
    if (candidates.some((value) => pageText.includes(value.toLowerCase()))) {
      hits.add(pageNumber);
    }
  }

  return Array.from(hits).sort((a, b) => a - b);
}

function buildFieldPageProvenance({
  pages,
  primaryType,
  typeName,
  coreFear,
  coreDesire,
  instinctualVariant,
  integrationLevel,
  metaMessage,
  strainInterpretations,
}) {
  const strain = strainInterpretations && typeof strainInterpretations === "object" ? strainInterpretations : {};
  return {
    primaryType: resolveFieldPageHits(pages, buildPrimaryTypePageTokens(primaryType)),
    typeName: resolveFieldPageHits(pages, [typeName]),
    coreFear: resolveFieldPageHits(pages, [coreFear]),
    coreDesire: resolveFieldPageHits(pages, [coreDesire]),
    instinctualVariant: resolveFieldPageHits(pages, [instinctualVariant]),
    integrationLevel: resolveFieldPageHits(pages, [integrationLevel]),
    metaMessage: resolveFieldPageHits(pages, [metaMessage]),
    strainSummaries: {
      happiness: resolveFieldPageHits(pages, [strain?.happiness]),
      vocational: resolveFieldPageHits(pages, [strain?.vocational]),
      interpersonal: resolveFieldPageHits(pages, [strain?.interpersonal]),
      physical: resolveFieldPageHits(pages, [strain?.physical]),
      environmental: resolveFieldPageHits(pages, [strain?.environmental]),
      psychological: resolveFieldPageHits(pages, [strain?.psychological]),
    },
  };
}

function jitterDelay(baseDelayMs) {
  const minJitterFactor = 0.8;
  const maxJitterFactor = 1.2;
  const jitterFactor = minJitterFactor + Math.random() * (maxJitterFactor - minJitterFactor);
  return Math.min(20_000, Math.max(1, Math.floor(baseDelayMs * jitterFactor)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  const normalizedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.floor(Number(timeoutMs))
    : DOC_INTEL_REQUEST_TIMEOUT_MS;
  let timeoutId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutError = new Error(timeoutMessage || "Operation timed out");
        timeoutError.name = "TimeoutError";
        reject(timeoutError);
      }, normalizedTimeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isRetryableStatus(status) {
  if (!Number.isFinite(Number(status))) return false;
  const normalized = Number(status);
  return RETRYABLE_HTTP_STATUS_CODES.has(normalized) || normalized >= 500;
}

function isRetryableFetchError(error) {
  const details = String(error?.message || error || "").toLowerCase();
  if (!details) return false;
  if (details.includes(STREAM_DISCONNECT_ERROR_SIGNATURE)) return true;
  return (
    details.includes("timeout") ||
    details.includes("timed out") ||
    details.includes("network") ||
    details.includes("failed to fetch") ||
    details.includes("fetch failed") ||
    details.includes("econnreset") ||
    details.includes("econnrefused") ||
    details.includes("etimedout") ||
    details.includes("socket hang up")
  );
}

async function extractPdfPagesWithPython(pdfBuffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ieq9-attached-parser-"));
  const inputPdfPath = path.join(tempDir, "report.pdf");
  try {
    await fs.writeFile(inputPdfPath, pdfBuffer);
    const parserScriptPath = fileURLToPath(new URL("./extract_pdf_pages.py", import.meta.url));
    const { stdout } = await execFileAsync("python3", [parserScriptPath, inputPdfPath], {
      maxBuffer: LOCAL_PYTHON_MAX_BUFFER_BYTES,
    });
    const payload = JSON.parse(String(stdout || "{}"));
    const payloadError = stringOrNull(payload?.error);
    if (payloadError) {
      throw new Error(`extract_pdf_pages.py reported an error: ${payloadError}`);
    }

    const extractionDiagnostics =
      payload?.diagnostics && typeof payload.diagnostics === "object"
        ? payload.diagnostics
        : null;
    const rawPages = asArray(payload?.pages);
    const cidArtifactCount = rawPages.reduce(
      (total, page) => total + countCidArtifacts(page?.extractedText),
      0,
    );
    if (cidArtifactCount > 0) {
      console.log("[parsePdf] stripped cid artifacts from local python page extraction", {
        cidArtifactCount,
        pageCount: rawPages.length,
      });
    }

    if (extractionDiagnostics) {
      const noisyPageNumbers = asArray(extractionDiagnostics?.noisyPageNumbers)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      const ocrAppliedPageNumbers = asArray(extractionDiagnostics?.ocrAppliedPageNumbers)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      const ocrFailedPageNumbers = asArray(extractionDiagnostics?.ocrFailedPageNumbers)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      const fallbackTriggered = Boolean(extractionDiagnostics?.fallbackTriggered);
      const fallbackError = stringOrNull(extractionDiagnostics?.fallbackError);

      if (fallbackTriggered) {
        console.log("[parsePdf] local python page extraction triggered OCR fallback diagnostics", {
          primaryEngine: stringOrNull(extractionDiagnostics?.primaryEngine) || null,
          noisyPageCount: noisyPageNumbers.length,
          ocrAppliedPageCount: ocrAppliedPageNumbers.length,
          ocrFailedPageCount: ocrFailedPageNumbers.length,
          fallbackError,
        });
      }

      // Do not silently hydrate from known-corrupted text streams. If noise is detected
      // and OCR did not recover any pages, fail this extraction path explicitly.
      if (fallbackTriggered && noisyPageNumbers.length > 0 && ocrAppliedPageNumbers.length === 0) {
        const reason = fallbackError || "OCR fallback did not recover any noisy pages.";
        throw new Error(
          `Noisy PDF pages detected (${noisyPageNumbers.length}) and OCR recovery failed: ${reason}`,
        );
      }
    }

    return rawPages
      .map((page, idx) => ({
        pageNumber: Number.isFinite(Number(page?.pageNumber)) ? Math.floor(Number(page.pageNumber)) : idx + 1,
        extractedText: sanitizePdfExtractedText(page?.extractedText, { preserveLineBreaks: true }),
      }))
      .filter((page) => Number.isFinite(page.pageNumber) && page.pageNumber > 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function normalizePythonLayoutExtractionPayload(payload, sourceFileName) {
  if (!payload || typeof payload !== "object") {
    return {
      available: false,
      source: "layout_html_markdown",
      reason: "invalid_python_payload",
      details: null,
      structuredDocument: null,
      tableFormat: null,
      fileName: stringOrNull(sourceFileName) || "report.pdf",
    };
  }

  const payloadError = stringOrNull(payload?.error);
  const structuredDocument = stringOrNull(
    sanitizePdfExtractedText(
      payload?.structured_document || payload?.structuredDocument || payload?.markdown,
      { preserveLineBreaks: true },
    ),
  );
  const source = stringOrNull(payload?.source) || "layout_html_markdown";
  const tableFormat = stringOrNull(payload?.table_format || payload?.tableFormat) || "html";

  return {
    available: Boolean(structuredDocument),
    source,
    reason: structuredDocument ? null : (payloadError ? "python_layout_extract_failed" : "empty_layout_document"),
    details: payloadError,
    structuredDocument,
    tableFormat,
    fileName: stringOrNull(payload?.fileName) || stringOrNull(sourceFileName) || "report.pdf",
  };
}

async function extractLayoutHtmlWithPython({
  pdfBuffer,
  sourceFileName,
}) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error("extractLayoutHtmlWithPython requires a non-empty PDF buffer.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ieq9-layout-html-"));
  const inputPdfPath = path.join(tempDir, "report.pdf");
  try {
    await fs.writeFile(inputPdfPath, pdfBuffer);
    const parserScriptPath = fileURLToPath(new URL("../scripts/extract_report_pdf.py", import.meta.url));
    const { stdout } = await execFileAsync("python3", [parserScriptPath, inputPdfPath], {
      maxBuffer: LOCAL_PYTHON_MAX_BUFFER_BYTES,
      timeout: PYTHON_VERIFICATION_TIMEOUT_MS,
    });
    const payload = JSON.parse(String(stdout || "{}"));
    const normalized = normalizePythonLayoutExtractionPayload(payload, sourceFileName);
    if (!normalized.available || !normalized.structuredDocument) {
      throw new Error(
        `extract_report_pdf.py did not return a usable structured document: ${
          normalized.details || normalized.reason || "unknown_error"
        }`,
      );
    }

    console.log("[parsePdf] Stage 1 layout extraction completed.", {
      sourceFileName: normalized.fileName,
      source: normalized.source,
      tableFormat: normalized.tableFormat,
      structuredChars: normalized.structuredDocument.length,
    });

    return normalized;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function normalizePythonVerificationPayload(payload, sourceFileName) {
  if (!payload || typeof payload !== "object") {
    return {
      available: false,
      source: "python_extract_report_pdf",
      reason: "invalid_python_payload",
      markdown: null,
    };
  }

  const typeName = stringOrNull(payload?.typeName);
  const detectedType =
    normalizeTypeNumber(payload?.detectedType) ||
    inferTypeNumberFromTypeName(typeName);
  const pageCount = Number.isFinite(Number(payload?.pageCount)) && Number(payload.pageCount) > 0
    ? Math.floor(Number(payload.pageCount))
    : null;
  const instinctLabel = stringOrNull(payload?.instinct || payload?.instinctLabel);
  const instinctCode = normalizeInstinctualVariant(payload?.instinctCode || payload?.instinct || payload?.instinctLabel);
  const integrationLevel = normalizeIntegrationValue(payload?.integrationLevel);
  const clientName = normalizeOptionalMetadataValue(payload?.clientName || payload?.client || payload?.name);
  const reportDate = normalizeOptionalMetadataValue(payload?.reportDate || payload?.date);
  const wing = normalizeOptionalMetadataValue(payload?.wing);
  const trifix = normalizeOptionalMetadataValue(payload?.trifix);
  const levelOfDevelopment = normalizeOptionalMetadataValue(payload?.levelOfDevelopment || payload?.developmentLevel);
  const centreOfIntelligence =
    normalizeOptionalMetadataValue(payload?.centreOfIntelligence || payload?.centerOfIntelligence);
  const textNoise = normalizeTextNoiseMetrics(payload?.textNoise);
  const markdown = stringOrNull(sanitizePdfExtractedText(payload?.markdown, { preserveLineBreaks: true }));
  const payloadError = stringOrNull(payload?.error);
  const hasIdentitySignal = Boolean(
    detectedType != null ||
    typeName ||
    instinctCode ||
    integrationLevel ||
    clientName ||
    reportDate ||
    wing ||
    trifix ||
    levelOfDevelopment ||
    centreOfIntelligence,
  );
  const hasDoclingMarkdown = Boolean(markdown);
  const available = hasIdentitySignal || hasDoclingMarkdown;
  const source = stringOrNull(payload?.source) || "python_extract_report_pdf";

  return {
    available,
    source,
    reason: !available
      ? (payloadError ? "python_verification_failed" : "python_verification_unavailable")
      : null,
    details: payloadError,
    fileName: stringOrNull(payload?.fileName) || stringOrNull(sourceFileName) || "report.pdf",
    pageCount,
    detectedType: detectedType == null ? null : String(detectedType),
    detectedTypeSource:
      stringOrNull(payload?.detectedTypeSource) ||
      (detectedType != null && typeName ? "typeNameInference" : null),
    typeName,
    instinctCode,
    instinctLabel,
    integrationLevel,
    clientName,
    reportDate,
    wing,
    trifix,
    levelOfDevelopment,
    centreOfIntelligence,
    textNoise,
    markdown,
    containsMarkers:
      payload?.containsMarkers && typeof payload.containsMarkers === "object"
        ? payload.containsMarkers
        : {},
  };
}

async function extractDashboardVerificationWithPython({
  pdfBuffer,
  sourceFileName,
  verificationOverride,
}) {
  if (verificationOverride && typeof verificationOverride === "object") {
    return normalizePythonVerificationPayload(verificationOverride, sourceFileName);
  }

  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    return {
      available: false,
      source: "python_extract_report_pdf",
      reason: "missing_pdf_buffer",
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ieq9-python-verifier-"));
  const inputPdfPath = path.join(tempDir, "report.pdf");
  try {
    await fs.writeFile(inputPdfPath, pdfBuffer);
    const parserScriptPath = fileURLToPath(new URL("../scripts/extract_report_pdf.py", import.meta.url));
    const { stdout } = await execFileAsync("python3", [parserScriptPath, inputPdfPath], {
      maxBuffer: LOCAL_PYTHON_MAX_BUFFER_BYTES,
      timeout: PYTHON_VERIFICATION_TIMEOUT_MS,
    });
    const payload = JSON.parse(String(stdout || "{}"));
    return normalizePythonVerificationPayload(payload, sourceFileName);
  } catch (error) {
    return {
      available: false,
      source: "python_extract_report_pdf",
      reason: "python_verification_failed",
      details: String(error?.message || error),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function createVerificationCheck({
  llmValue,
  pythonValue,
  normalize = (value) => value,
}) {
  const llmComparable = normalize(llmValue);
  const pythonComparable = normalize(pythonValue);
  const hasLlm = llmComparable != null && String(llmComparable).length > 0;
  const hasPython = pythonComparable != null && String(pythonComparable).length > 0;

  if (!hasLlm || !hasPython) {
    return {
      llm: llmValue ?? null,
      python: pythonValue ?? null,
      status: "insufficient_data",
    };
  }

  return {
    llm: llmValue,
    python: pythonValue,
    status: llmComparable === pythonComparable ? "match" : "mismatch",
  };
}

function buildPythonVerificationCrossCheck({
  parsedData,
  pythonVerification,
  extractedPageCount,
}) {
  if (!pythonVerification?.available) {
    return {
      available: false,
      source: pythonVerification?.source || "python_extract_report_pdf",
      reason: pythonVerification?.reason || "python_verification_unavailable",
      details: stringOrNull(pythonVerification?.details),
      noise: null,
      checks: {},
      mismatchKeys: [],
      criticalMismatchKeys: [],
      mismatchCount: 0,
      criticalMismatchCount: 0,
      fallbackApplied: {
        primaryType: false,
        typeName: false,
        instinctualVariant: false,
        integrationLevel: false,
        clientName: false,
        reportDate: false,
        wing: false,
        trifix: false,
        levelOfDevelopment: false,
        centreOfIntelligence: false,
      },
      resolvedFields: {
        primaryType: normalizeTypeNumber(parsedData?.primaryType),
        typeName: stringOrNull(parsedData?.typeName),
        instinctualVariant: normalizeInstinctualVariant(parsedData?.instinctualVariant),
        integrationLevel: normalizeIntegrationValue(parsedData?.integrationLevel),
        clientName: normalizeOptionalMetadataValue(parsedData?.clientName),
        reportDate: normalizeOptionalMetadataValue(parsedData?.reportDate),
        wing: normalizeOptionalMetadataValue(parsedData?.wing),
        trifix: normalizeOptionalMetadataValue(parsedData?.trifix),
        levelOfDevelopment: normalizeOptionalMetadataValue(parsedData?.levelOfDevelopment),
        centreOfIntelligence: normalizeOptionalMetadataValue(parsedData?.centreOfIntelligence),
        detectedTotalPages: Number.isFinite(Number(extractedPageCount)) ? Number(extractedPageCount) : null,
      },
      isVerifiedForHydration: false,
    };
  }

  const pythonPrimaryType = normalizeTypeNumber(pythonVerification?.detectedType);
  const pythonTypeName = stringOrNull(pythonVerification?.typeName);
  const pythonInstinctualVariant = normalizeInstinctualVariant(
    pythonVerification?.instinctCode || pythonVerification?.instinctLabel,
  );
  const pythonIntegrationLevel = normalizeIntegrationValue(pythonVerification?.integrationLevel);
  const pythonClientName = normalizeOptionalMetadataValue(pythonVerification?.clientName);
  const pythonReportDate = normalizeOptionalMetadataValue(pythonVerification?.reportDate);
  const pythonWing = normalizeOptionalMetadataValue(pythonVerification?.wing);
  const pythonTrifix = normalizeOptionalMetadataValue(pythonVerification?.trifix);
  const pythonLevelOfDevelopment = normalizeOptionalMetadataValue(pythonVerification?.levelOfDevelopment);
  const pythonCentreOfIntelligence = normalizeOptionalMetadataValue(pythonVerification?.centreOfIntelligence);
  const normalizedTextNoise = normalizeTextNoiseMetrics(pythonVerification?.textNoise);
  const pythonPageCount = Number.isFinite(Number(pythonVerification?.pageCount)) && Number(pythonVerification.pageCount) > 0
    ? Math.floor(Number(pythonVerification.pageCount))
    : null;
  const extractedPages = Number.isFinite(Number(extractedPageCount)) && Number(extractedPageCount) > 0
    ? Math.floor(Number(extractedPageCount))
    : null;

  const checks = {
    primaryType: createVerificationCheck({
      llmValue: normalizeTypeNumber(parsedData?.primaryType),
      pythonValue: pythonPrimaryType,
      normalize: normalizeTypeNumber,
    }),
    typeName: createVerificationCheck({
      llmValue: stringOrNull(parsedData?.typeName),
      pythonValue: pythonTypeName,
      normalize: normalizeTypeNameForCompare,
    }),
    instinctualVariant: createVerificationCheck({
      llmValue: normalizeInstinctualVariant(parsedData?.instinctualVariant),
      pythonValue: pythonInstinctualVariant,
      normalize: normalizeInstinctualVariant,
    }),
    integrationLevel: createVerificationCheck({
      llmValue: normalizeIntegrationValue(parsedData?.integrationLevel),
      pythonValue: pythonIntegrationLevel,
      normalize: normalizeIntegrationValue,
    }),
    pageCoverage: extractedPages != null && pythonPageCount != null
      ? {
          llm: extractedPages,
          python: pythonPageCount,
          status: extractedPages >= pythonPageCount ? "match" : "mismatch",
        }
      : {
          llm: extractedPages,
          python: pythonPageCount,
          status: "insufficient_data",
        },
  };

  const mismatchKeys = Object.entries(checks)
    .filter(([, check]) => check?.status === "mismatch")
    .map(([key]) => key);
  const criticalMismatchKeys = mismatchKeys.filter((key) =>
    key === "primaryType" || key === "instinctualVariant" || key === "integrationLevel"
  );

  const llmTypeName = stringOrNull(parsedData?.typeName);
  const preferredTypeName = !isPlaceholderTypeName(llmTypeName)
    ? llmTypeName
    : null;

  const resolvedFields = {
    // Python verification is authoritative for deterministic identity anchors.
    primaryType:
      pythonPrimaryType ||
      normalizeTypeNumber(parsedData?.primaryType) ||
      inferTypeNumberFromTypeName(parsedData?.typeName),
    // Keep LLM as preferred source for narrative identity naming unless it is clearly placeholder text.
    typeName: preferredTypeName || pythonTypeName || llmTypeName,
    instinctualVariant: pythonInstinctualVariant || normalizeInstinctualVariant(parsedData?.instinctualVariant),
    integrationLevel: pythonIntegrationLevel || normalizeIntegrationValue(parsedData?.integrationLevel),
    clientName: pythonClientName || normalizeOptionalMetadataValue(parsedData?.clientName),
    reportDate: pythonReportDate || normalizeOptionalMetadataValue(parsedData?.reportDate),
    wing: pythonWing || normalizeOptionalMetadataValue(parsedData?.wing),
    trifix: pythonTrifix || normalizeOptionalMetadataValue(parsedData?.trifix),
    levelOfDevelopment: pythonLevelOfDevelopment || normalizeOptionalMetadataValue(parsedData?.levelOfDevelopment),
    centreOfIntelligence:
      pythonCentreOfIntelligence || normalizeOptionalMetadataValue(parsedData?.centreOfIntelligence),
    detectedTotalPages: pythonPageCount || extractedPages,
  };

  return {
    available: true,
    source: pythonVerification?.source || "python_extract_report_pdf",
    noise: normalizedTextNoise,
    python: {
      ...pythonVerification,
      detectedType: pythonPrimaryType == null ? null : String(pythonPrimaryType),
      instinctCode: pythonInstinctualVariant,
      integrationLevel: pythonIntegrationLevel,
      pageCount: pythonPageCount,
      textNoise: normalizedTextNoise,
    },
    checks,
    mismatchKeys,
    criticalMismatchKeys,
    mismatchCount: mismatchKeys.length,
    criticalMismatchCount: criticalMismatchKeys.length,
    fallbackApplied: {
      primaryType: false,
      typeName: false,
      instinctualVariant: false,
      integrationLevel: false,
      clientName: false,
      reportDate: false,
      wing: false,
      trifix: false,
      levelOfDevelopment: false,
      centreOfIntelligence: false,
    },
    resolvedFields,
    isVerifiedForHydration: criticalMismatchKeys.length === 0,
  };
}

function applyVerificationResolvedFieldFallbacks(parsedData, verification) {
  const nextParsedData = parsedData && typeof parsedData === "object" ? { ...parsedData } : {};
  const resolvedFields =
    verification?.resolvedFields && typeof verification.resolvedFields === "object"
      ? verification.resolvedFields
      : {};
  const fallbackApplied = {
    primaryType: false,
    typeName: false,
    instinctualVariant: false,
    integrationLevel: false,
    clientName: false,
    reportDate: false,
    wing: false,
    trifix: false,
    levelOfDevelopment: false,
    centreOfIntelligence: false,
  };

  const resolvedPrimaryType = normalizeTypeNumber(resolvedFields?.primaryType);
  if (!normalizeTypeNumber(nextParsedData?.primaryType) && resolvedPrimaryType != null) {
    nextParsedData.primaryType = resolvedPrimaryType;
    nextParsedData.core_type = resolvedPrimaryType;
    if (!hasAnyFiniteScore(nextParsedData?.typeScores)) {
      nextParsedData.typeScores = buildTypeScoresFromPrimaryType(resolvedPrimaryType);
    }
    fallbackApplied.primaryType = true;
  }

  const resolvedTypeName = stringOrNull(resolvedFields?.typeName);
  const currentTypeName = stringOrNull(nextParsedData?.typeName);
  if ((!currentTypeName || isPlaceholderTypeName(currentTypeName)) && resolvedTypeName) {
    nextParsedData.typeName = resolvedTypeName;
    nextParsedData.core_type_name = resolvedTypeName;
    nextParsedData.primaryTypeName = resolvedTypeName;
    nextParsedData.typeTitle = resolvedTypeName;
    fallbackApplied.typeName = true;
  }

  const resolvedInstinctualVariant = normalizeInstinctualVariant(resolvedFields?.instinctualVariant);
  if (!normalizeInstinctualVariant(nextParsedData?.instinctualVariant) && resolvedInstinctualVariant) {
    nextParsedData.instinctualVariant = resolvedInstinctualVariant;
    if (!hasAnyFiniteScore(nextParsedData?.instinctScores)) {
      nextParsedData.instinctScores = buildInstinctScoresFromVariant(resolvedInstinctualVariant);
    }
    fallbackApplied.instinctualVariant = true;
  }

  const resolvedIntegrationLevel = normalizeIntegrationValue(resolvedFields?.integrationLevel);
  if (!stringOrNull(nextParsedData?.integrationLevel) && resolvedIntegrationLevel) {
    nextParsedData.integrationLevel = resolvedIntegrationLevel;
    fallbackApplied.integrationLevel = true;
  }

  const resolvedClientName = normalizeOptionalMetadataValue(resolvedFields?.clientName);
  if (!normalizeOptionalMetadataValue(nextParsedData?.clientName) && resolvedClientName) {
    nextParsedData.clientName = resolvedClientName;
    fallbackApplied.clientName = true;
  }

  const resolvedReportDate = normalizeOptionalMetadataValue(resolvedFields?.reportDate);
  if (!normalizeOptionalMetadataValue(nextParsedData?.reportDate) && resolvedReportDate) {
    nextParsedData.reportDate = resolvedReportDate;
    fallbackApplied.reportDate = true;
  }

  const resolvedWing = normalizeOptionalMetadataValue(resolvedFields?.wing);
  if (!normalizeOptionalMetadataValue(nextParsedData?.wing) && resolvedWing) {
    nextParsedData.wing = resolvedWing;
    fallbackApplied.wing = true;
  }

  const resolvedTrifix = normalizeOptionalMetadataValue(resolvedFields?.trifix);
  if (!normalizeOptionalMetadataValue(nextParsedData?.trifix) && resolvedTrifix) {
    nextParsedData.trifix = resolvedTrifix;
    fallbackApplied.trifix = true;
  }

  const resolvedLevelOfDevelopment = normalizeOptionalMetadataValue(resolvedFields?.levelOfDevelopment);
  if (!normalizeOptionalMetadataValue(nextParsedData?.levelOfDevelopment) && resolvedLevelOfDevelopment) {
    nextParsedData.levelOfDevelopment = resolvedLevelOfDevelopment;
    fallbackApplied.levelOfDevelopment = true;
  }

  const resolvedCentreOfIntelligence = normalizeOptionalMetadataValue(resolvedFields?.centreOfIntelligence);
  if (!normalizeOptionalMetadataValue(nextParsedData?.centreOfIntelligence) && resolvedCentreOfIntelligence) {
    nextParsedData.centreOfIntelligence = resolvedCentreOfIntelligence;
    fallbackApplied.centreOfIntelligence = true;
  }

  return {
    parsedData: nextParsedData,
    fallbackApplied,
  };
}

function extractPrimaryTypeFromRawText(rawText) {
  const text = sanitizePdfExtractedText(rawText, { preserveLineBreaks: false });
  if (!text) return null;

  const patterns = [
    /\bM\s*A\s*I\s*N\s*T\s*Y\s*P\s*E\b[^0-9]{0,20}([1-9])\b/i,
    /\bMain\s*Type\b[^0-9]{0,20}([1-9])\b/i,
    /\bType\s*([1-9])\s*(?:[·•|]|-|—)\s*(?:SX|SO|SP)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const detectedType = normalizeTypeNumber(match?.[1]);
    if (detectedType != null) {
      return detectedType;
    }
  }
  return null;
}

function extractDominantInstinctFromRawText(rawText) {
  const text = sanitizePdfExtractedText(rawText, { preserveLineBreaks: false });
  if (!text) return null;

  const patterns = [
    /\bDominant\s*Instinct\b[^A-Za-z]{0,12}(SO|SP|SX)\b/i,
    /\b(?:SO|SP|SX)\b\s*[—-]\s*(?:Social|Self[\s-]?Preservation|One[\s-]?on[\s-]?One)\b/i,
    /\b(?:Instinct|Subtype)\b[^A-Za-z]{0,12}(SO|SP|SX)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const detectedInstinct = normalizeInstinctualVariant(match?.[1] || match?.[0]);
    if (detectedInstinct) {
      return detectedInstinct;
    }
  }
  return null;
}

function applyDeterministicRawTextFallbacks(parsedData, rawText) {
  const nextParsedData = parsedData && typeof parsedData === "object" ? { ...parsedData } : {};
  const detectedPrimaryType = extractPrimaryTypeFromRawText(rawText);
  const detectedDominantInstinct = extractDominantInstinctFromRawText(rawText);
  const identityBeforePatch = {
    primaryType:
      normalizeTypeNumber(nextParsedData?.primaryType) ||
      normalizeTypeNumber(nextParsedData?.primary_type) ||
      normalizeTypeNumber(nextParsedData?.core_profile?.type_number),
    dominantInstinct:
      normalizeInstinctualVariant(nextParsedData?.instinctualVariant) ||
      normalizeInstinctualVariant(nextParsedData?.dominant_instinct) ||
      normalizeInstinctualVariant(nextParsedData?.core_profile?.instinctual_subtype?.type),
  };

  if (nextParsedData?.core_profile && typeof nextParsedData.core_profile === "object") {
    nextParsedData.core_profile = { ...nextParsedData.core_profile };
  }
  if (nextParsedData?.core_profile?.instinctual_subtype && typeof nextParsedData.core_profile.instinctual_subtype === "object") {
    nextParsedData.core_profile.instinctual_subtype = {
      ...nextParsedData.core_profile.instinctual_subtype,
    };
  }

  if (!normalizeTypeNumber(nextParsedData?.primaryType) && detectedPrimaryType != null) {
    nextParsedData.primaryType = detectedPrimaryType;
  }
  if (!normalizeTypeNumber(nextParsedData?.primary_type) && detectedPrimaryType != null) {
    nextParsedData.primary_type = String(detectedPrimaryType);
  }
  if (!normalizeTypeNumber(nextParsedData?.core_profile?.type_number) && detectedPrimaryType != null) {
    if (!nextParsedData.core_profile || typeof nextParsedData.core_profile !== "object") {
      nextParsedData.core_profile = {};
    }
    nextParsedData.core_profile.type_number = detectedPrimaryType;
  }

  if (!normalizeInstinctualVariant(nextParsedData?.instinctualVariant) && detectedDominantInstinct) {
    nextParsedData.instinctualVariant = detectedDominantInstinct;
  }
  if (!normalizeInstinctualVariant(nextParsedData?.dominant_instinct) && detectedDominantInstinct) {
    nextParsedData.dominant_instinct = detectedDominantInstinct;
  }
  if (!normalizeInstinctualVariant(nextParsedData?.core_profile?.instinctual_subtype?.type) && detectedDominantInstinct) {
    if (!nextParsedData.core_profile || typeof nextParsedData.core_profile !== "object") {
      nextParsedData.core_profile = {};
    }
    if (!nextParsedData.core_profile.instinctual_subtype || typeof nextParsedData.core_profile.instinctual_subtype !== "object") {
      nextParsedData.core_profile.instinctual_subtype = {};
    }
    nextParsedData.core_profile.instinctual_subtype.type = String(detectedDominantInstinct).toUpperCase();
  }

  const identityAfterPatch = {
    primaryType:
      normalizeTypeNumber(nextParsedData?.primaryType) ||
      normalizeTypeNumber(nextParsedData?.primary_type) ||
      normalizeTypeNumber(nextParsedData?.core_profile?.type_number),
    dominantInstinct:
      normalizeInstinctualVariant(nextParsedData?.instinctualVariant) ||
      normalizeInstinctualVariant(nextParsedData?.dominant_instinct) ||
      normalizeInstinctualVariant(nextParsedData?.core_profile?.instinctual_subtype?.type),
  };

  console.log("[parsePdf] Applied deterministic raw-text fallback extraction for critical identity fields.", {
    patchedPrimaryType:
      identityBeforePatch.primaryType == null &&
      identityAfterPatch.primaryType != null,
    patchedDominantInstinct:
      !identityBeforePatch.dominantInstinct &&
      Boolean(identityAfterPatch.dominantInstinct),
    detectedPrimaryType,
    detectedDominantInstinct,
  });

  return nextParsedData;
}

function applyPythonVerificationFallbacksToParsedData(parsedData, verificationOrRawText) {
  if (typeof verificationOrRawText === "string") {
    return applyDeterministicRawTextFallbacks(parsedData, verificationOrRawText);
  }
  return applyVerificationResolvedFieldFallbacks(parsedData, verificationOrRawText);
}

function buildUserContent({ rawText, ragContext, extractionLearningContext }) {
  const ragPrefix = buildCanonicalRagPromptPrefix(ragContext);
  const extractionLearningPrefix = buildExtractionLearningPromptPrefix(extractionLearningContext);
  const combinedPrefix = [extractionLearningPrefix, ragPrefix].filter(Boolean).join("\n\n");
  const normalizedRawText = stringOrNull(rawText);
  if (!normalizedRawText) {
    throw new Error("Repaired HTML report text is required for LLM parsing.");
  }
  const markdownInstruction = "Extract the required JSON strictly from the following repaired HTML report.";
  if (combinedPrefix) {
    return `${combinedPrefix}\n\n${markdownInstruction}\n\n${normalizedRawText}`;
  }
  return `${markdownInstruction}\n\n${normalizedRawText}`;
}

function splitRawTextIntoChunks(rawText, maxChunkChars, options = {}) {
  const normalizedText = sanitizePdfExtractedText(rawText, { preserveLineBreaks: true });
  if (!normalizedText) return [];
  const targetSize = Number.isFinite(Number(maxChunkChars)) && Number(maxChunkChars) > 0
    ? Math.floor(Number(maxChunkChars))
    : RAW_TEXT_CHUNK_MAX_CHARS;
  const overlapChars = Number.isFinite(Number(options?.overlapChars)) && Number(options.overlapChars) > 0
    ? Math.min(Math.floor(Number(options.overlapChars)), Math.floor(targetSize * 0.45))
    : 0;

  const chunks = [];
  let start = 0;
  while (start < normalizedText.length) {
    let end = Math.min(start + targetSize, normalizedText.length);
    if (end < normalizedText.length) {
      const preferredBreak = normalizedText.lastIndexOf("\n[Page ", end);
      if (preferredBreak > start + 4000) {
        end = preferredBreak;
      } else {
        const newlineBreak = normalizedText.lastIndexOf("\n", end);
        if (newlineBreak > start + 2000) {
          end = newlineBreak;
        } else {
          const whitespaceBreak = normalizedText.lastIndexOf(" ", end);
          if (whitespaceBreak > start + 1200) {
            end = whitespaceBreak;
          }
        }
      }
    }
    const nextChunk = normalizedText.slice(start, end).trim();
    if (nextChunk) {
      chunks.push(nextChunk);
    }
    if (end >= normalizedText.length) {
      break;
    }
    const overlapStart = overlapChars > 0 ? Math.max(0, end - overlapChars) : end;
    start = overlapStart > start ? overlapStart : end;
  }
  return chunks.filter(Boolean);
}

function isEmptyStructuredValue(value) {
  if (value == null) return true;
  if (typeof value === "string") return normalizeWhitespace(value).length === 0;
  if (Array.isArray(value)) return value.length === 0 || value.every((entry) => isEmptyStructuredValue(entry));
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return true;
    return keys.every((key) => isEmptyStructuredValue(value[key]));
  }
  return false;
}

function mergeStructuredArrays(baseArray, incomingArray) {
  const base = Array.isArray(baseArray) ? baseArray : [];
  const incoming = Array.isArray(incomingArray) ? incomingArray : [];
  if (base.length === 0) return [...incoming];
  if (incoming.length === 0) return [...base];

  const merged = [...base];
  const seen = new Set(base.map((entry) => normalizeWhitespace(serializeObject(entry))));
  for (const entry of incoming) {
    const signature = normalizeWhitespace(serializeObject(entry));
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    merged.push(entry);
  }
  return merged;
}

function mergeStructuredPair(baseValue, incomingValue) {
  if (incomingValue == null) return baseValue;
  if (baseValue == null) return incomingValue;

  if (Array.isArray(baseValue) || Array.isArray(incomingValue)) {
    return mergeStructuredArrays(baseValue, incomingValue);
  }

  if (typeof baseValue === "object" && typeof incomingValue === "object") {
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(incomingValue)]);
    const merged = {};
    for (const key of keys) {
      merged[key] = mergeStructuredPair(baseValue[key], incomingValue[key]);
    }
    return merged;
  }

  if (typeof baseValue === "string" || typeof incomingValue === "string") {
    const baseText = normalizeWhitespace(baseValue || "");
    const incomingText = normalizeWhitespace(incomingValue || "");
    if (!baseText && incomingText) return incomingValue;
    if (baseText && !incomingText) return baseValue;
    if (!baseText && !incomingText) return baseValue;
    return incomingText.length > baseText.length ? incomingValue : baseValue;
  }

  if (typeof baseValue === "number" && Number.isFinite(baseValue)) return baseValue;
  if (typeof incomingValue === "number" && Number.isFinite(incomingValue)) return incomingValue;
  return isEmptyStructuredValue(baseValue) ? incomingValue : baseValue;
}

function mergeStructuredObjects(objectsOrBase, incomingValue) {
  if (Array.isArray(objectsOrBase) && typeof incomingValue === "undefined") {
    return objectsOrBase.reduce((acc, entry) => mergeStructuredPair(acc, entry), null);
  }
  return mergeStructuredPair(objectsOrBase, incomingValue);
}

function stripCodeFenceWrappers(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/```$/, "").trim();
}

function extractJsonContentString(payload) {
  const directContent = payload?.choices?.[0]?.message?.content;
  if (typeof directContent === "string" && directContent.trim()) {
    return stripCodeFenceWrappers(directContent);
  }

  if (Array.isArray(directContent)) {
    for (const part of directContent) {
      if (typeof part === "string" && part.trim()) return stripCodeFenceWrappers(part);
      if (typeof part?.text === "string" && part.text.trim()) return stripCodeFenceWrappers(part.text);
    }
  }

  const outputText = payload?.output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return stripCodeFenceWrappers(outputText);
  }

  if (Array.isArray(payload?.output)) {
    for (const outputItem of payload.output) {
      const outputContent = asArray(outputItem?.content);
      for (const outputChunk of outputContent) {
        const chunkText = outputChunk?.text;
        if (typeof chunkText === "string" && chunkText.trim()) {
          return stripCodeFenceWrappers(chunkText);
        }
      }
    }
  }

  throw new Error("Azure OpenAI response did not include JSON content");
}

function normalizeStatusCode(status) {
  if (!Number.isFinite(Number(status))) return null;
  return Math.floor(Number(status));
}

function buildDocIntelErrorFromResponse(response, fallbackLabel) {
  const statusCode = normalizeStatusCode(response?.status);
  const message =
    stringOrNull(response?.body?.error?.message) ||
    stringOrNull(response?.body?.message) ||
    stringOrNull(response?.body?.error?.innererror?.message) ||
    fallbackLabel ||
    "Unknown Azure Document Intelligence error";
  const error = new Error(
    `Azure Document Intelligence Error (${statusCode || "unknown"}): ${message}`,
  );
  if (statusCode != null) {
    error.statusCode = statusCode;
  }
  return error;
}

async function extractMarkdownWithAzureDocIntel(pdfBuffer, options = {}) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error("A non-empty PDF buffer is required for Azure Document Intelligence extraction.");
  }

  const endpoint = normalizeAzureEnvVar(
    options?.endpoint || process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    { stripTrailingSlash: true },
  );
  const apiKey = normalizeAzureEnvVar(options?.apiKey || process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY);
  const sourceFileName = stringOrNull(options?.sourceFileName) || "report.pdf";
  const timeoutMs = Number.isFinite(Number(options?.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Math.floor(Number(options.timeoutMs))
    : DOC_INTEL_REQUEST_TIMEOUT_MS;
  const pollerFactory = typeof options?.pollerFactory === "function" ? options.pollerFactory : getLongRunningPoller;
  const unexpectedResponse = typeof options?.isUnexpectedResponse === "function" ? options.isUnexpectedResponse : isUnexpected;
  const preflight = buildDocIntelPreflightStatus({
    endpoint,
    apiKey,
  });
  if (!preflight.isReady) {
    throw new Error(
      `Missing Azure Document Intelligence environment variables: ${preflight.missingEnvVars.join(
        ", ",
      )}. Configure these env vars before parsing.`,
    );
  }

  const client = options?.client || DocumentIntelligence(endpoint, { key: apiKey });
  const maxRetries = DOC_INTEL_RETRY_BASE_DELAYS_MS.length;
  let lastFailure = null;

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    try {
      const initialResponse = await withTimeout(
        client
          .path("/documentModels/{modelId}:analyze", "prebuilt-layout")
          .post({
            contentType: "application/json",
            body: {
              base64Source: pdfBuffer.toString("base64"),
            },
            queryParameters: {
              outputContentFormat: "markdown",
            },
          }),
        timeoutMs,
        "Azure Document Intelligence analyze request timed out.",
      );

      if (unexpectedResponse(initialResponse)) {
        const requestError = buildDocIntelErrorFromResponse(initialResponse, "Analyze request failed.");
        lastFailure = requestError;
        const retryable = isRetryableStatus(requestError?.statusCode);
        if (retryable && attemptIndex < maxRetries) {
          const delayMs = jitterDelay(DOC_INTEL_RETRY_BASE_DELAYS_MS[attemptIndex]);
          console.log("[parsePdf] Retrying Azure Document Intelligence after analyze request failure.", {
            sourceFileName,
            attempt: attemptIndex + 1,
            nextAttempt: attemptIndex + 2,
            delayMs,
            errorClass: `http_${requestError?.statusCode || "unknown"}`,
          });
          await sleep(delayMs);
          continue;
        }
        throw requestError;
      }

      const poller = pollerFactory(client, initialResponse);
      const finalResponse = await withTimeout(
        poller.pollUntilDone(),
        timeoutMs,
        "Azure Document Intelligence analyze polling timed out.",
      );

      if (unexpectedResponse(finalResponse)) {
        const pollError = buildDocIntelErrorFromResponse(finalResponse, "Analyze polling failed.");
        lastFailure = pollError;
        const retryable = isRetryableStatus(pollError?.statusCode);
        if (retryable && attemptIndex < maxRetries) {
          const delayMs = jitterDelay(DOC_INTEL_RETRY_BASE_DELAYS_MS[attemptIndex]);
          console.log("[parsePdf] Retrying Azure Document Intelligence after polling failure.", {
            sourceFileName,
            attempt: attemptIndex + 1,
            nextAttempt: attemptIndex + 2,
            delayMs,
            errorClass: `http_${pollError?.statusCode || "unknown"}`,
          });
          await sleep(delayMs);
          continue;
        }
        throw pollError;
      }

      const markdown = sanitizePdfExtractedText(finalResponse?.body?.analyzeResult?.content, {
        preserveLineBreaks: true,
      });
      if (!stringOrNull(markdown)) {
        throw new Error("Azure Document Intelligence returned empty markdown content.");
      }

      return markdown;
    } catch (error) {
      lastFailure = error;
      const statusCode = normalizeStatusCode(error?.statusCode);
      const retryable = isRetryableStatus(statusCode) || isRetryableFetchError(error);
      if (!retryable || attemptIndex >= maxRetries) {
        throw error;
      }
      const delayMs = jitterDelay(DOC_INTEL_RETRY_BASE_DELAYS_MS[attemptIndex]);
      console.log("[parsePdf] Retrying Azure Document Intelligence after transient failure.", {
        sourceFileName,
        attempt: attemptIndex + 1,
        nextAttempt: attemptIndex + 2,
        delayMs,
        errorClass: String(error?.name || "doc_intel_error"),
        details: String(error?.message || error),
      });
      await sleep(delayMs);
    }
  }

  throw lastFailure || new Error("Azure Document Intelligence extraction failed after retries.");
}

async function detectPdfPageCount(pdfBuffer) {
  try {
    const loadedPdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pageCount = Number(loadedPdf.getPageCount());
    if (Number.isFinite(pageCount) && pageCount > 0) {
      return Math.floor(pageCount);
    }
    return null;
  } catch (error) {
    console.log("[parsePdf] Unable to detect PDF page count with pdf-lib; will use fallback.", {
      details: String(error?.message || error),
    });
    return null;
  }
}

function normalizeLlamaParseTextOutput(payload) {
  if (typeof payload === "string") {
    return sanitizePdfExtractedText(payload, { preserveLineBreaks: true });
  }

  if (Array.isArray(payload)) {
    return payload
      .map((entry) => normalizeLlamaParseTextOutput(entry))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  if (!payload || typeof payload !== "object") {
    return "";
  }

  const directCandidates = [
    payload.markdown,
    payload.content,
    payload.text,
    payload.pageContent,
  ];
  for (const candidate of directCandidates) {
    const normalized = sanitizePdfExtractedText(candidate, { preserveLineBreaks: true });
    if (normalized) {
      return normalized;
    }
  }

  const nestedCandidates = [
    payload.documents,
    payload.pages,
    payload.results,
  ];
  for (const candidate of nestedCandidates) {
    const normalized = normalizeLlamaParseTextOutput(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

async function extractTextWithLlamaParse(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error("A non-empty PDF buffer is required for LlamaParse extraction.");
  }

  const reader = new LlamaParseReader({
    resultType: "markdown",
    useVendorMultimodalModel: true,
    outputTablesAsHTML: true,
  });

  let result = null;
  if (typeof reader?.loadDataAsContent === "function") {
    result = await reader.loadDataAsContent(pdfBuffer, "report.pdf");
  } else if (typeof reader?.loadData === "function") {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "llamaparse-"));
    const tmpPdfPath = path.join(tmpDir, `report-${Date.now()}.pdf`);
    await fs.writeFile(tmpPdfPath, pdfBuffer);
    try {
      result = await reader.loadData(tmpPdfPath);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } else {
    throw new Error("LlamaParseReader is missing a supported data loading method.");
  }

  const extracted = normalizeLlamaParseTextOutput(result);
  if (!extracted) {
    throw new Error("LlamaParse returned empty markdown output.");
  }

  console.log("[parsePdf] LlamaParse layout extraction completed.", {
    chars: extracted.length,
    parserVersion: PARSER_VERSION,
  });

  return extracted;
}

async function sendAzureChatCompletionRequest({
  openAiUrl,
  apiKey,
  requestBody,
  requestFn,
  logLabel,
}) {
  const dispatchRequest = typeof requestFn === "function" ? requestFn : fetch;
  const label = stringOrNull(logLabel) || "[parsePdf]";
  const normalizedRequestBody = {
    ...(requestBody && typeof requestBody === "object" ? requestBody : {}),
  };
  if (!stringOrNull(openAiUrl) || !stringOrNull(apiKey)) {
    throw new Error("sendAzureChatCompletionRequest requires openAiUrl and apiKey.");
  }

  const maxRetries = OPENAI_RETRY_BASE_DELAYS_MS.length;
  let lastFailure = null;

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    try {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), OPENAI_REQUEST_TIMEOUT_MS);
      let response;
      try {
        response = await dispatchRequest(openAiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify(normalizedRequestBody),
          signal: timeoutController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const responseText = typeof response.text === "function" ? await response.text() : "Unknown response body";
        const error = new Error(`Azure OpenAI Error (${response.status}): ${responseText}`);
        const retryable = isRetryableStatus(response.status);
        lastFailure = error;
        if (retryable && attemptIndex < maxRetries) {
          const delayMs = jitterDelay(OPENAI_RETRY_BASE_DELAYS_MS[attemptIndex]);
          console.log(`${label} Retrying Azure request after HTTP failure.`, {
            attempt: attemptIndex + 1,
            nextAttempt: attemptIndex + 2,
            delayMs,
            errorClass: `http_${response.status}`,
          });
          await sleep(delayMs);
          continue;
        }
        throw error;
      }

      return response.json();
    } catch (error) {
      lastFailure = error;
      const retryable = isRetryableFetchError(error);
      if (!retryable || attemptIndex >= maxRetries) {
        throw error;
      }
      const delayMs = jitterDelay(OPENAI_RETRY_BASE_DELAYS_MS[attemptIndex]);
      console.log(`${label} Retrying Azure request after transient network error.`, {
        attempt: attemptIndex + 1,
        nextAttempt: attemptIndex + 2,
        delayMs,
        errorClass: String(error?.name || "network_error"),
        details: String(error?.message || error),
      });
      await sleep(delayMs);
    }
  }

  throw lastFailure || new Error("Azure OpenAI request failed after retries.");
}

async function agenticOcrRepair(rawHtml, options = {}) {
  const normalizedRawHtml = stringOrNull(rawHtml);
  if (!normalizedRawHtml) {
    throw new Error("agenticOcrRepair requires a non-empty rawHtml input.");
  }

  const openAiUrl = stringOrNull(options?.openAiUrl);
  const apiKey = stringOrNull(options?.apiKey);
  if (!openAiUrl || !apiKey) {
    throw new Error("agenticOcrRepair requires openAiUrl and apiKey.");
  }

  console.log("[parsePdf] Running agentic OCR repair stage.", {
    rawChars: normalizedRawHtml.length,
    sourceFileName: stringOrNull(options?.sourceFileName) || "report.pdf",
  });

  const payload = await sendAzureChatCompletionRequest({
    openAiUrl,
    apiKey,
    requestFn: options?.requestFn,
    logLabel: "[parsePdf][agenticOcrRepair]",
    requestBody: {
      messages: [
        {
          role: "system",
          content: AGENTIC_OCR_REPAIR_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Repair the following OCR-derived HTML/markdown content in-place.\n\n${normalizedRawHtml}`,
        },
      ],
      temperature: 0,
    },
  });

  const repairedText = stringOrNull(extractJsonContentString(payload));
  if (!repairedText) {
    throw new Error("agenticOcrRepair returned an empty repaired text payload.");
  }

  console.log("[parsePdf] Agentic OCR repair stage completed.", {
    repairedChars: repairedText.length,
    sourceFileName: stringOrNull(options?.sourceFileName) || "report.pdf",
  });

  return repairedText;
}

async function extractAttachedStructuredJson({
  openAiUrl,
  apiKey,
  repairedHtml,
  ragContext,
  extractionLearningContext,
  requestFn,
}) {
  const normalizedRepairedHtml = stringOrNull(repairedHtml);
  if (!normalizedRepairedHtml) {
    throw new Error("extractAttachedStructuredJson requires repairedHtml content.");
  }

  const payload = await sendAzureChatCompletionRequest({
    openAiUrl,
    apiKey,
    requestFn,
    logLabel: "[parsePdf][extractAttachedStructuredJson]",
    requestBody: {
      messages: [
        {
          role: "system",
          content: ATTACHED_JSON_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildUserContent({
            rawText: normalizedRepairedHtml,
            ragContext,
            extractionLearningContext,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "enneagram_dashboard_payload",
          strict: true,
          schema: ATTACHED_JSON_RESPONSE_SCHEMA,
        },
      },
      temperature: 0,
    },
  });

  const content = extractJsonContentString(payload);
  return JSON.parse(content);
}

async function extractStructuredJsonFromMarkdown({
  openAiUrl,
  apiKey,
  markdownText,
  ragContext,
  extractionLearningContext,
  requestFn,
}) {
  return extractAttachedStructuredJson({
    openAiUrl,
    apiKey,
    repairedHtml: markdownText,
    ragContext,
    extractionLearningContext,
    requestFn,
  });
}

async function mockChunkStructuredLlmParse({ chunkText }) {
  const normalizedChunkText = sanitizePdfExtractedText(chunkText, { preserveLineBreaks: true });
  const detectedPrimaryType = extractPrimaryTypeFromRawText(normalizedChunkText);
  const detectedDominantInstinct = extractDominantInstinctFromRawText(normalizedChunkText);
  const clientNameMatch = normalizedChunkText.match(/\bClient\s*Name\s*[:\-]?\s*([A-Za-z][A-Za-z\s'-]{1,60})\b/i);
  const reportDateMatch = normalizedChunkText.match(
    /\b(?:Report\s*Date|Date\s*of\s*Report)\s*[:\-]?\s*([0-9]{1,4}[\/.\-][0-9]{1,2}[\/.\-][0-9]{1,4})\b/i,
  );

  const mockPayload = {
    client: {
      name: stringOrNull(clientNameMatch?.[1]),
      date: stringOrNull(reportDateMatch?.[1]),
    },
    core_profile: {
      type_number: detectedPrimaryType,
      instinctual_subtype: {
        type: detectedDominantInstinct ? String(detectedDominantInstinct).toUpperCase() : null,
        description: null,
      },
    },
  };

  console.log("[parsePdf] Mock chunk parser generated deterministic partial payload.", {
    detectedPrimaryType,
    detectedDominantInstinct,
    hasClientName: Boolean(mockPayload?.client?.name),
    hasReportDate: Boolean(mockPayload?.client?.date),
  });

  return mockPayload;
}

async function runChunkedStructuredExtraction({
  normalizedRawText,
  sourceFileName,
  maxSinglePassChars = RAW_TEXT_SINGLE_PASS_MAX_CHARS,
  maxChunkChars = RAW_TEXT_CHUNK_MAX_CHARS,
  chunkOverlapChars = RAW_TEXT_CHUNK_OVERLAP_CHARS,
  parseChunkWithLlm,
}) {
  if (!normalizedRawText) {
    throw new Error("No extractable PDF text found.");
  }

  const parseChunk = typeof parseChunkWithLlm === "function" ? parseChunkWithLlm : mockChunkStructuredLlmParse;
  if (normalizedRawText.length <= maxSinglePassChars) {
    return parseChunk({
      chunkText: normalizedRawText,
      chunkIndex: 0,
      totalChunks: 1,
      isSinglePass: true,
      sourceFileName,
    });
  }

  const chunks = splitRawTextIntoChunks(normalizedRawText, maxChunkChars, {
    overlapChars: chunkOverlapChars,
  });
  if (chunks.length <= 1) {
    return parseChunk({
      chunkText: normalizedRawText,
      chunkIndex: 0,
      totalChunks: 1,
      isSinglePass: true,
      sourceFileName,
    });
  }

  console.log("[parsePdf] Raw text exceeds single-pass payload limits; using chunked LLM parsing.", {
    chunkCount: chunks.length,
    chars: normalizedRawText.length,
    maxSinglePassChars,
    maxChunkChars,
    chunkOverlapChars,
  });

  const parsedChunks = [];
  let successfulChunks = 0;
  const failedChunks = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkText = chunks[index];
    try {
      const partialStructured = await parseChunk({
        chunkText,
        chunkIndex: index,
        totalChunks: chunks.length,
        isSinglePass: false,
        sourceFileName,
      });
      if (partialStructured && typeof partialStructured === "object") {
        parsedChunks.push(partialStructured);
      }
      successfulChunks += 1;
      console.log("[parsePdf] Chunk parsed successfully.", {
        chunk: `${index + 1}/${chunks.length}`,
        chars: chunkText.length,
      });
    } catch (error) {
      failedChunks.push({
        chunk: index + 1,
        details: String(error?.message || error),
      });
      console.log("[parsePdf] Chunk parse failed.", {
        chunk: `${index + 1}/${chunks.length}`,
        chars: chunkText.length,
        details: String(error?.message || error),
      });
    }
  }

  const mergedStructured = mergeStructuredObjects(parsedChunks);
  if (successfulChunks === 0 || !mergedStructured || typeof mergedStructured !== "object") {
    const summary = failedChunks
      .slice(0, 3)
      .map((entry) => `#${entry.chunk}: ${entry.details}`)
      .join(" | ");
    throw new Error(`Chunked LLM parsing failed for all chunks. ${summary}`);
  }

  if (failedChunks.length > 0) {
    console.log("[parsePdf] Chunked parsing completed with partial chunk failures.", {
      successfulChunks,
      failedChunks: failedChunks.map((entry) => entry.chunk),
    });
  }

  return mergedStructured;
}

async function extractStructuredJsonFromRawText(input, options = {}) {
  if (typeof input === "string") {
    const normalizedRawText = sanitizePdfExtractedText(input, { preserveLineBreaks: true });
    const parseOptions = options && typeof options === "object" ? options : {};
    return runChunkedStructuredExtraction({
      normalizedRawText,
      sourceFileName: parseOptions?.sourceFileName || "report.pdf",
      maxSinglePassChars: parseOptions?.maxSinglePassChars,
      maxChunkChars: parseOptions?.maxChunkChars,
      chunkOverlapChars: parseOptions?.chunkOverlapChars,
      parseChunkWithLlm: parseOptions?.parseChunkWithLlm || parseOptions?.mockLlmParseChunk,
    });
  }

  const extractionConfig = input && typeof input === "object" ? input : {};
  const normalizedRawText = sanitizePdfExtractedText(extractionConfig?.rawText, { preserveLineBreaks: true });
  const {
    openAiUrl,
    apiKey,
    sourceFileName,
    ragContext,
    extractionLearningContext,
    maxSinglePassChars = RAW_TEXT_SINGLE_PASS_MAX_CHARS,
    maxChunkChars = RAW_TEXT_CHUNK_MAX_CHARS,
    chunkOverlapChars = RAW_TEXT_CHUNK_OVERLAP_CHARS,
  } = extractionConfig;

  return runChunkedStructuredExtraction({
    normalizedRawText,
    sourceFileName,
    maxSinglePassChars,
    maxChunkChars,
    chunkOverlapChars,
    parseChunkWithLlm: async ({ chunkText, chunkIndex, totalChunks, isSinglePass }) => {
      const promptText = isSinglePass
        ? chunkText
        : `This is chunk ${chunkIndex + 1} of ${totalChunks} from the full report "${sourceFileName || "report.pdf"}".\nExtract whatever fields are present in this chunk and leave unknown fields empty.\n\n${chunkText}`;
      return extractStructuredJsonFromMarkdown({
        openAiUrl,
        apiKey,
        markdownText: promptText,
        ragContext,
        extractionLearningContext,
      });
    },
  });
}

function mapAttachedToLegacyPayload({
  structured,
  pages,
  reportId,
}) {
  const client = structured?.client || {};
  const core = structured?.core_profile || {};
  const strain = structured?.strain_profile || {};
  const centers = structured?.centers_of_expression || {};
  const lines = structured?.lines_of_development || {};
  const communication = structured?.communication_dynamics || {};
  const feedback = structured?.feedback || {};
  const conflict = structured?.conflict_and_triggers || {};
  const decision = structured?.decision_making || {};
  const leadership = structured?.leadership_and_management || {};
  const team = structured?.team_behaviour || {};
  const coaching = structured?.coaching_relationship || {};

  const typeName = stringOrNull(core?.type_name);
  const primaryType = normalizeTypeNumber(core?.type_number) || inferTypeNumberFromTypeName(typeName);
  const coreFear = stringOrNull(core?.core_fear);
  const coreDesire = stringOrNull(core?.core_motivation);
  const instinctualVariant = normalizeInstinctualVariant(core?.instinctual_subtype?.type);
  const integrationLevel = stringOrNull(core?.level_of_integration);
  const metaMessage = stringOrNull(core?.meta_message);

  const actionLabel = normalizeLevelUpper(centers?.action?.level);
  const feelingLabel = normalizeLevelUpper(centers?.feeling?.level);
  const thinkingLabel = normalizeLevelUpper(centers?.thinking?.level);
  const centerLabels = {
    action: actionLabel,
    feeling: feelingLabel,
    thinking: thinkingLabel,
  };
  const centerScores = {
    body: normalizeLevelLabel(actionLabel),
    heart: normalizeLevelLabel(feelingLabel),
    head: normalizeLevelLabel(thinkingLabel),
  };

  const levelFrom = (category) => normalizeLevelLabel(strain?.[category]?.level);
  const levels = {
    overall: normalizeLevelLabel(strain?.overall?.level),
    vocational: levelFrom("vocational"),
    interpersonal: levelFrom("interpersonal"),
    environmental: levelFrom("environmental"),
    physical: levelFrom("physical"),
    psychological: levelFrom("psychological"),
    happiness: levelFrom("happiness"),
  };

  const summaryFrom = (category) => stringOrNull(strain?.[category]?.summary) || `${category[0].toUpperCase()}${category.slice(1)} strain not detected.`;
  const overallStrainSummary = stringOrNull(strain?.overall?.summary);
  const strainInterpretations = {
    happiness: summaryFrom("happiness"),
    vocational: summaryFrom("vocational"),
    interpersonal: summaryFrom("interpersonal"),
    physical: summaryFrom("physical"),
    environmental: summaryFrom("environmental"),
    psychological: summaryFrom("psychological"),
  };

  const strain_profile = {
    overall: normalizeLevelUpper(levels.overall),
    vocational: normalizeLevelUpper(levels.vocational),
    interpersonal: normalizeLevelUpper(levels.interpersonal),
    environmental: normalizeLevelUpper(levels.environmental),
    physical: normalizeLevelUpper(levels.physical),
    psychological: normalizeLevelUpper(levels.psychological),
    happiness: normalizeLevelUpper(levels.happiness),
  };

  const strain_levels = {
    overall_strain: levels.overall,
    vocational_strain: levels.vocational,
    interpersonal_strain: levels.interpersonal,
    environmental_strain: levels.environmental,
    physical_strain: levels.physical,
    psychological_strain: levels.psychological,
    happiness_strain: levels.happiness,
  };

  const strain_scores = {
    overall: levelLabelToVisualScore(levels.overall),
    vocational: levelLabelToVisualScore(levels.vocational),
    interpersonal: levelLabelToVisualScore(levels.interpersonal),
    environmental: levelLabelToVisualScore(levels.environmental),
    physical: levelLabelToVisualScore(levels.physical),
    psychological: levelLabelToVisualScore(levels.psychological),
    happiness: levelLabelToVisualScore(levels.happiness),
  };

  const developmentExercises = Array.from(new Set([
    ...asArray(lines?.wing_influence).map((entry) => stringOrNull(entry)).filter(Boolean),
    ...asArray(coaching?.opportunities).map((entry) => stringOrNull(entry)).filter(Boolean),
    ...asArray(team?.performing).map((entry) => stringOrNull(entry)).filter(Boolean),
  ]));

  const coachingRelationship = [
    ...asArray(coaching?.needs).map((entry) => `Needs: ${normalizeWhitespace(entry)}`).filter((entry) => !entry.endsWith(":")),
    ...asArray(coaching?.challenges).map((entry) => `Challenges: ${normalizeWhitespace(entry)}`).filter((entry) => !entry.endsWith(":")),
    ...asArray(coaching?.opportunities).map((entry) => `Opportunities: ${normalizeWhitespace(entry)}`).filter((entry) => !entry.endsWith(":")),
  ];

  const feedbackGuideMatrix = [
    {
      type: "Giving Feedback",
      guidance: asArray(feedback?.giving).map((entry) => normalizeWhitespace(entry)).filter(Boolean).join(" ").trim() || null,
    },
    {
      type: "Receiving Feedback",
      guidance: asArray(feedback?.receiving).map((entry) => normalizeWhitespace(entry)).filter(Boolean).join(" ").trim() || null,
    },
  ].filter((row) => row.guidance);

  const teamStageBreakdown = {
    forming: asArray(team?.forming).map((entry) => normalizeWhitespace(entry)).filter(Boolean).join(" ").trim() || null,
    storming: asArray(team?.storming).map((entry) => normalizeWhitespace(entry)).filter(Boolean).join(" ").trim() || null,
    norming: asArray(team?.norming).map((entry) => normalizeWhitespace(entry)).filter(Boolean).join(" ").trim() || null,
    performing: asArray(team?.performing).map((entry) => normalizeWhitespace(entry)).filter(Boolean).join(" ").trim() || null,
  };

  const sections = buildSectionsFromAttached(structured);
  const pageSnapshots = asArray(pages).map((page, idx) => ({
    pageNumber: Number.isFinite(Number(page?.pageNumber)) ? Number(page.pageNumber) : idx + 1,
    heading: `Page ${Number.isFinite(Number(page?.pageNumber)) ? Number(page.pageNumber) : idx + 1}`,
    sectionTitle: null,
    extractedText: stringOrNull(page?.extractedText),
    keyDataPoints: [],
  }));

  const typeScores = Object.fromEntries(
    Array.from({ length: 9 }, (_, idx) => [`type${idx + 1}`, (primaryType === idx + 1 ? 100 : null)]),
  );
  const instinctScores = {
    sexual: instinctualVariant === "sx" ? 100 : null,
    social: instinctualVariant === "so" ? 100 : null,
    selfPreservation: instinctualVariant === "sp" ? 100 : null,
  };
  const fieldPageProvenance = buildFieldPageProvenance({
    pages: pageSnapshots,
    primaryType,
    typeName,
    coreFear,
    coreDesire,
    instinctualVariant,
    integrationLevel,
    metaMessage,
    strainInterpretations,
  });
  const normalizedList = (value, { maxItems = 10 } = {}) =>
    asArray(value)
      .map((entry) => normalizeWhitespace(entry))
      .filter(Boolean)
      .slice(0, Math.max(1, Number(maxItems) || 10));
  const joinList = (value, options = {}) => {
    const joined = normalizedList(value, options).join(" ").trim();
    return joined || null;
  };
  const splitNarrativeRows = (value, { maxItems = 8 } = {}) => {
    const normalized = normalizeWhitespace(value || "");
    if (!normalized) return [];
    const symbolSplit = normalized
      .split(/\s*[•·▪◦*]\s+/)
      .map((row) => normalizeWhitespace(row))
      .filter(Boolean);
    const rows = symbolSplit.length > 1
      ? symbolSplit
      : (normalized.match(/[^.!?]{12,240}(?:[.!?]|$)/g) || [])
        .map((row) => normalizeWhitespace(row))
        .filter(Boolean);
    return Array.from(new Set(rows)).slice(0, Math.max(1, Number(maxItems) || 8));
  };
  const dominantInstinctCode = normalizeInstinctualVariant(core?.instinctual_subtype?.type);
  const instinctDescription = stringOrNull(core?.instinctual_subtype?.description);
  const instinctGoals = {
    selfPres: dominantInstinctCode === "sp" ? instinctDescription : null,
    social: dominantInstinctCode === "so" ? instinctDescription : null,
    oneOnOne: dominantInstinctCode === "sx" ? instinctDescription : null,
  };
  const bodyLanguageRows = splitNarrativeRows(communication?.body_language, { maxItems: 6 });
  const conflictTriggerRows = normalizedList(conflict?.behavior_when_triggered, { maxItems: 12 });
  const conflictResponseRows = normalizedList(conflict?.what_others_should_do, { maxItems: 10 });
  const conflictPrimaryTriggerRows = normalizedList(conflict?.primary_triggers, { maxItems: 10 });
  const decisionApproach = stringOrNull(decision?.approach);
  const decisionDrawbacks = stringOrNull(decision?.drawbacks);
  const decisionStrainImpact = stringOrNull(decision?.impact_of_strain);
  const strategicLeadershipCopy =
    stringOrNull(leadership?.strategic_leadership) ||
    stringOrNull(leadership?.goal_setting) ||
    null;
  const teamImpactCopy =
    stringOrNull(team?.ideal_role) ||
    joinList(team?.performing, { maxItems: 8 }) ||
    null;
  const interdependenceCopy =
    joinList(team?.norming, { maxItems: 8 }) ||
    joinList(team?.forming, { maxItems: 8 }) ||
    null;
  const coachingRelationshipCopy = coachingRelationship.join(" ").trim() || null;
  const developmentExerciseRows = developmentExercises
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean)
    .slice(0, 12);

  return {
    clientName: stringOrNull(client?.name),
    reportDate: stringOrNull(client?.date),
    typeNumber: primaryType == null ? null : String(primaryType),
    primaryType,
    typeName,
    core_type: primaryType,
    core_type_name: typeName,
    primaryTypeName: typeName,
    typeTitle: typeName,
    wing: null,
    trifix: null,
    levelOfDevelopment: null,
    centreOfIntelligence: null,
    instinctualVariant,
    integrationLevel,
    metaMessage,
    coreFear,
    coreDesire,
    connectedLineA: stringOrNull(lines?.release_point?.type),
    connectedLineB: stringOrNull(lines?.stretch_point?.type),
    centerLabels,
    centers_of_expression: {
      action: actionLabel,
      feeling: feelingLabel,
      thinking: thinkingLabel,
      center_specific_styles: [
        stringOrNull(centers?.action?.mode),
        stringOrNull(centers?.feeling?.mode),
        stringOrNull(centers?.thinking?.mode),
      ].filter(Boolean),
    },
    centersOfExpression: {
      action: actionLabel,
      feeling: feelingLabel,
      thinking: thinkingLabel,
      center_specific_styles: [
        stringOrNull(centers?.action?.mode),
        stringOrNull(centers?.feeling?.mode),
        stringOrNull(centers?.thinking?.mode),
      ].filter(Boolean),
    },
    centerScores,
    strain_profile,
    strainLevels: {
      happiness: levels.happiness,
      vocational: levels.vocational,
      interpersonal: levels.interpersonal,
      physical: levels.physical,
      environmental: levels.environmental,
      psychological: levels.psychological,
    },
    strainScores: {
      happiness: levels.happiness,
      vocational: levels.vocational,
      interpersonal: levels.interpersonal,
      physical: levels.physical,
      environmental: levels.environmental,
      psychological: levels.psychological,
    },
    strainInterpretations,
    strain_interpretations: strainInterpretations,
    strainNarratives: strainInterpretations,
    qualitativeStrain: strainInterpretations,
    strainComments: strainInterpretations,
    overallStrainSummary,
    strain_levels,
    strain_scores,
    developmentExercises,
    development_exercises: developmentExercises,
    feedbackGuideMatrix,
    teamStageBreakdown,
    coachingRelationship,
    reportSummary: `Agentic OCR extraction completed for ${reportId || "uploaded report"}.`,
    reportContent: {
      documentSummary: `Processed ${pageSnapshots.length} pages using layout-aware extraction + agentic OCR repair + LLM structuring.`,
      developmentExercisesText: developmentExercises.join("\n\n"),
      developmentExercises,
      development_exercises: developmentExercises,
      sections,
      pages: pageSnapshots,
    },
    typeScores,
    instinctScores,
    fieldPageProvenance,
    attachedProfile: structured,
    spreadsheetFocuses: {
      motivationSummary: stringOrNull(core?.core_motivation) || stringOrNull(core?.core_fear),
      instinctGoals,
      developingAsCopy: joinList(developmentExerciseRows, { maxItems: 4 }),
      developingAsBullets: developmentExerciseRows,
      bodyLanguageRows,
      conflictResponseCopy:
        joinList(conflictResponseRows, { maxItems: 6 }) ||
        joinList(conflictPrimaryTriggerRows, { maxItems: 6 }) ||
        null,
      conflictTriggeredCopy:
        joinList(conflictTriggerRows, { maxItems: 6 }) ||
        joinList(conflictPrimaryTriggerRows, { maxItems: 6 }) ||
        null,
      conflictTriggeredBullets: conflictTriggerRows,
      centeredDecisionCopy: decisionApproach,
      decisionImpactCopy: decisionDrawbacks,
      decisionStrainCopy: decisionStrainImpact,
      strategicLeadershipCopy,
      teamImpactCopy,
      interdependenceCopy,
      coachingRelationshipCopy,
      communicationDynamics: serializeObject(communication),
      decisionMaking: serializeObject(decision),
      leadershipAndManagement: serializeObject(leadership),
      conflictAndTriggers: serializeObject(conflict),
      teamBehaviour: serializeObject(team),
      coachingRelationship: serializeObject(coaching),
    },
  };
}

export async function parsePdf(pdfBuffer, optionsOrId) {
  const parseOptions = optionsOrId && typeof optionsOrId === "object" ? optionsOrId : {};
  const reportId = parseOptions?.reportId || (typeof optionsOrId !== "object" ? optionsOrId : null);
  const expectedPages = Number.isFinite(Number(parseOptions?.parseMinExpectedPages)) && Number(parseOptions.parseMinExpectedPages) > 0
    ? Math.floor(Number(parseOptions.parseMinExpectedPages))
    : 42;
  const requireChartScoresForComplete = Boolean(parseOptions?.requireChartScoresForComplete);
  const allowLocalTextFallback = parseOptions?.allowLocalTextFallback !== false;
  const enablePythonCrossCheck = parseOptions?.enablePythonCrossCheck !== false;
  const enableCanonicalRag = parseOptions?.enableCanonicalRag !== false;
  const extractionLearningContext = normalizeExtractionLearningContext(parseOptions?.extractionLearningContext);
  const pythonVerificationOverride =
    parseOptions?.pythonVerificationOverride && typeof parseOptions.pythonVerificationOverride === "object"
      ? parseOptions.pythonVerificationOverride
      : null;
  const rawTextSinglePassMaxChars = Number.isFinite(Number(parseOptions?.rawTextSinglePassMaxChars))
    ? Math.max(50, Math.floor(Number(parseOptions.rawTextSinglePassMaxChars)))
    : RAW_TEXT_SINGLE_PASS_MAX_CHARS;
  const rawTextChunkMaxChars = Number.isFinite(Number(parseOptions?.rawTextChunkMaxChars))
    ? Math.max(50, Math.floor(Number(parseOptions.rawTextChunkMaxChars)))
    : RAW_TEXT_CHUNK_MAX_CHARS;
  let lastKnownExtractedPageCount = 0;
  let lastKnownVerification = {
    available: false,
    source: "python_extract_report_pdf",
    reason: enablePythonCrossCheck ? "python_verification_not_run" : "python_verification_disabled",
  };
  let lastKnownCanonicalRag = {
    enabled: enableCanonicalRag,
    available: false,
    reason: enableCanonicalRag ? "not_initialized" : "disabled",
    source: RAG_SOURCE_LABEL_UPLOADED_REPORT,
    sourcePath: null,
    queryTokenCount: 0,
    retrievedChunkCount: 0,
    retrievedChars: 0,
  };
  let lastKnownExtractionLearning = extractionLearningContext;
  let preflightMissingOpenAiEnvVars = [];
  let preflightMissingDocIntelEnvVars = [];
  let preflightMissingLlamaEnvVars = [];
  let llamaRequiredForRun = false;
  let docIntelRequiredForRun = false;

  console.log(`[parsePdf] Starting agentic OCR parsing pipeline for ${reportId || "new report"}...`);

  try {
    const endpoint = normalizeAzureEnvVar(process.env.AZURE_OPENAI_ENDPOINT, { stripTrailingSlash: true });
    const deployment = normalizeAzureEnvVar(process.env.AZURE_OPENAI_DEPLOYMENT_NAME);
    const apiKey = normalizeAzureEnvVar(process.env.AZURE_OPENAI_API_KEY);
    const docIntelEndpoint = normalizeAzureEnvVar(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, {
      stripTrailingSlash: true,
    });
    const docIntelApiKey = normalizeAzureEnvVar(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY);
    const llamaCloudApiKey = normalizeAzureEnvVar(process.env.LLAMA_CLOUD_API_KEY);

    const rawTextOverrideInput = parseOptions?.rawTextOverride;
    const layoutHtmlOverrideInput = parseOptions?.layoutHtmlOverride;
    const rawTextOverride = stringOrNull(
      sanitizePdfExtractedText(rawTextOverrideInput, { preserveLineBreaks: true }),
    );
    const layoutHtmlOverride = stringOrNull(
      sanitizePdfExtractedText(layoutHtmlOverrideInput, { preserveLineBreaks: true }),
    );
    const rawTextOverrideCidCount = countCidArtifacts(rawTextOverrideInput);
    if (rawTextOverrideCidCount > 0) {
      console.log("[parsePdf] sanitized cid artifacts from rawTextOverride before extraction", {
        cidArtifactCount: rawTextOverrideCidCount,
      });
    }
    const pageCountOverride = Number.isFinite(Number(parseOptions?.pageCountOverride))
      ? Math.max(1, Math.floor(Number(parseOptions.pageCountOverride)))
      : null;
    const pagesOverride = normalizePagesOverride(parseOptions?.pagesOverride);
    const hasPagesOverrideText = pagesOverride.some((page) => stringOrNull(page?.extractedText));
    const sourceFileName = stringOrNull(parseOptions?.sourceFileName) || "report.pdf";

    if (!rawTextOverride && (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0)) {
      throw new Error("PDF buffer is required when rawTextOverride is not provided.");
    }

    llamaRequiredForRun = false;
    docIntelRequiredForRun = false;
    const preflight = buildAzurePreflightStatus({
      endpoint,
      deployment,
      apiKey,
      docIntelEndpoint,
      docIntelKey: docIntelApiKey,
      llamaCloudApiKey,
      requireDocIntel: docIntelRequiredForRun,
      requireLlama: llamaRequiredForRun,
    });
    const missingByProvider = partitionMissingAzureEnvVars(preflight.missingEnvVars);
    preflightMissingOpenAiEnvVars = missingByProvider.openAi;
    preflightMissingDocIntelEnvVars = missingByProvider.docIntel;
    preflightMissingLlamaEnvVars = missingByProvider.llama;
    if (!preflight.isReady) {
      throw new Error(
        `Missing Azure environment variables: ${preflight.missingEnvVars.join(
          ", ",
        )}. Configure these env vars before parsing.`,
      );
    }

    let canonicalRagContext = await buildCanonicalRagContext({
      enabled: enableCanonicalRag,
      rawText: rawTextOverride,
      sourceFileName,
    });
    lastKnownCanonicalRag = canonicalRagContext;
    console.log(
      "[parsePdf] Extraction learning context status before extraction.",
      summarizeExtractionLearningDiagnostics(lastKnownExtractionLearning),
    );
    console.log("[parsePdf] Canonical RAG status before extraction.", summarizeCanonicalRagDiagnostics(canonicalRagContext));

    let extractedPages = [];
    let structured = null;
    let extractionMethod = "raw_text_override";
    const openAiUrl = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-08-01-preview`;

    if (rawTextOverride) {
      extractedPages = hasPagesOverrideText
        ? pagesOverride
        : buildOverridePages(rawTextOverride, pageCountOverride || 1);
      lastKnownExtractedPageCount = extractedPages.length;
      console.log("[parsePdf] Using provided rawTextOverride for LLM parse.", {
        pages: extractedPages.length,
        chars: rawTextOverride.length,
        pagesOverrideUsed: hasPagesOverrideText,
        parserVersion: PARSER_VERSION,
      });
      structured = await extractStructuredJsonFromRawText({
        openAiUrl,
        apiKey,
        rawText: rawTextOverride,
        sourceFileName,
        ragContext: canonicalRagContext,
        extractionLearningContext: lastKnownExtractionLearning,
        maxSinglePassChars: rawTextSinglePassMaxChars,
        maxChunkChars: rawTextChunkMaxChars,
      });
    } else {
      const detectedPageCount = pageCountOverride || await detectPdfPageCount(pdfBuffer);
      const effectivePageCount = detectedPageCount || expectedPages;
      if (!detectedPageCount) {
        console.log("[parsePdf] Falling back to expected page count for diagnostics coverage.", {
          expectedPages,
          parserVersion: PARSER_VERSION,
        });
      }

      try {
        const stageOneLayoutExtraction = layoutHtmlOverride
          ? {
            structuredDocument: layoutHtmlOverride,
            source: "layout_html_override",
            fileName: sourceFileName,
            tableFormat: "html",
          }
          : await extractLayoutHtmlWithPython({
            pdfBuffer,
            sourceFileName,
          });
        const stageOneLayoutHtml = stageOneLayoutExtraction.structuredDocument;
        extractedPages = buildOverridePages(stageOneLayoutHtml, effectivePageCount);
        lastKnownExtractedPageCount = extractedPages.length;
        extractionMethod = layoutHtmlOverride ? "layout_html_override" : "layout_html_python";
        console.log("[parsePdf] Using Stage 1 layout-aware extraction output for parsing.", {
          pages: extractedPages.length,
          chars: stageOneLayoutHtml.length,
          sourceFileName,
          parserVersion: PARSER_VERSION,
        });

        const repairedHtml = await agenticOcrRepair(stageOneLayoutHtml, {
          openAiUrl,
          apiKey,
          sourceFileName,
        });
        extractedPages = buildOverridePages(repairedHtml, effectivePageCount);
        lastKnownExtractedPageCount = extractedPages.length;
        extractionMethod = "agentic_ocr_repaired_html";
        console.log("[parsePdf] Stage 2 agentic OCR repair completed.", {
          pages: extractedPages.length,
          repairedChars: repairedHtml.length,
          sourceFileName,
          parserVersion: PARSER_VERSION,
        });

        if (enableCanonicalRag) {
          canonicalRagContext = await buildCanonicalRagContext({
            enabled: true,
            rawText: repairedHtml,
            sourceFileName,
          });
          lastKnownCanonicalRag = canonicalRagContext;
          console.log(
            "[parsePdf] Canonical RAG context refreshed from repaired HTML.",
            summarizeCanonicalRagDiagnostics(canonicalRagContext),
          );
        }

        structured = await extractAttachedStructuredJson({
          openAiUrl,
          apiKey,
          repairedHtml,
          ragContext: canonicalRagContext,
          extractionLearningContext: lastKnownExtractionLearning,
        });
      } catch (agenticPipelineError) {
        if (!allowLocalTextFallback) throw agenticPipelineError;

        console.log("[parsePdf] Agentic pipeline failed; retrying through local full-text extraction fallback.", {
          details: String(agenticPipelineError?.message || agenticPipelineError),
          parserVersion: PARSER_VERSION,
        });

        extractedPages = await extractPdfPagesWithPython(pdfBuffer);
        lastKnownExtractedPageCount = extractedPages.length;
        const fallbackRawText = buildRawTextFromPages(extractedPages, { withPageMarkers: true });
        if (!fallbackRawText) {
          throw new Error("No extractable PDF text found from local fallback.");
        }

        if (enableCanonicalRag) {
          canonicalRagContext = await buildCanonicalRagContext({
            enabled: true,
            rawText: fallbackRawText,
            sourceFileName,
          });
          lastKnownCanonicalRag = canonicalRagContext;
          console.log(
            "[parsePdf] Canonical RAG context refreshed from local fallback text.",
            summarizeCanonicalRagDiagnostics(canonicalRagContext),
          );
        }

        extractionMethod = "local_text_fallback";
        structured = await extractStructuredJsonFromRawText({
          openAiUrl,
          apiKey,
          rawText: fallbackRawText,
          sourceFileName,
          ragContext: canonicalRagContext,
          extractionLearningContext: lastKnownExtractionLearning,
          maxSinglePassChars: rawTextSinglePassMaxChars,
          maxChunkChars: rawTextChunkMaxChars,
        });
      }
    }

    const extractedPageCount = extractedPages.length;
    if (!structured || typeof structured !== "object") {
      throw new Error("LLM parsing did not return structured JSON payload.");
    }

    let parsedData = mapAttachedToLegacyPayload({
      structured,
      pages: extractedPages,
      reportId,
    });

    const pythonVerification = enablePythonCrossCheck
      ? (
        await extractDashboardVerificationWithPython({
          pdfBuffer,
          sourceFileName,
          verificationOverride: pythonVerificationOverride,
        })
      )
      : {
        available: false,
        source: "python_extract_report_pdf",
        reason: "python_verification_disabled",
      };
    lastKnownVerification = pythonVerification;

    let verification = buildPythonVerificationCrossCheck({
      parsedData,
      pythonVerification,
      extractedPageCount,
    });

    const fallbackResult = applyPythonVerificationFallbacksToParsedData(parsedData, verification);
    parsedData = fallbackResult.parsedData;

    const deterministicFallbackRawText = stringOrNull(
      rawTextOverride || buildRawTextFromPages(extractedPages, { withPageMarkers: true }),
    );
    const identityBeforeDeterministicFallback = {
      primaryType: normalizeTypeNumber(parsedData?.primaryType),
      instinctualVariant: normalizeInstinctualVariant(parsedData?.instinctualVariant),
    };
    if (deterministicFallbackRawText) {
      parsedData = applyPythonVerificationFallbacksToParsedData(parsedData, deterministicFallbackRawText);
    }
    const identityAfterDeterministicFallback = {
      primaryType: normalizeTypeNumber(parsedData?.primaryType),
      instinctualVariant: normalizeInstinctualVariant(parsedData?.instinctualVariant),
    };
    const deterministicFallbackApplied = {
      primaryType:
        identityBeforeDeterministicFallback.primaryType == null &&
        identityAfterDeterministicFallback.primaryType != null,
      instinctualVariant:
        !identityBeforeDeterministicFallback.instinctualVariant &&
        Boolean(identityAfterDeterministicFallback.instinctualVariant),
    };

    verification = {
      ...verification,
      fallbackApplied: {
        ...fallbackResult.fallbackApplied,
        primaryType:
          Boolean(fallbackResult?.fallbackApplied?.primaryType) ||
          deterministicFallbackApplied.primaryType,
        instinctualVariant:
          Boolean(fallbackResult?.fallbackApplied?.instinctualVariant) ||
          deterministicFallbackApplied.instinctualVariant,
      },
      resolvedFields: {
        ...verification.resolvedFields,
        primaryType:
          verification?.resolvedFields?.primaryType ||
          normalizeTypeNumber(parsedData?.primaryType) ||
          inferTypeNumberFromTypeName(parsedData?.typeName) ||
          null,
        typeName: stringOrNull(parsedData?.typeName) || verification?.resolvedFields?.typeName || null,
        instinctualVariant:
          verification?.resolvedFields?.instinctualVariant ||
          normalizeInstinctualVariant(parsedData?.instinctualVariant) ||
          null,
        integrationLevel:
          verification?.resolvedFields?.integrationLevel ||
          normalizeIntegrationValue(parsedData?.integrationLevel) ||
          null,
        clientName:
          normalizeOptionalMetadataValue(parsedData?.clientName) ||
          verification?.resolvedFields?.clientName ||
          null,
        reportDate:
          normalizeOptionalMetadataValue(parsedData?.reportDate) ||
          verification?.resolvedFields?.reportDate ||
          null,
        wing:
          normalizeOptionalMetadataValue(parsedData?.wing) ||
          verification?.resolvedFields?.wing ||
          null,
        trifix:
          normalizeOptionalMetadataValue(parsedData?.trifix) ||
          verification?.resolvedFields?.trifix ||
          null,
        levelOfDevelopment:
          normalizeOptionalMetadataValue(parsedData?.levelOfDevelopment) ||
          verification?.resolvedFields?.levelOfDevelopment ||
          null,
        centreOfIntelligence:
          normalizeOptionalMetadataValue(parsedData?.centreOfIntelligence) ||
          verification?.resolvedFields?.centreOfIntelligence ||
          null,
      },
    };

    const typeScores = parsedData?.typeScores && typeof parsedData.typeScores === "object" ? parsedData.typeScores : {};
    const instinctScores = parsedData?.instinctScores && typeof parsedData.instinctScores === "object" ? parsedData.instinctScores : {};
    const centerScores = parsedData?.centerScores && typeof parsedData.centerScores === "object" ? parsedData.centerScores : {};

    const typeScoresNonNull = Object.values(typeScores).filter((value) => value != null).length;
    const instinctScoresNonNull = Object.values(instinctScores).filter((value) => value != null).length;
    const centerScoresNonNull = Object.values(centerScores).filter((value) => value != null).length;
    const hasAllChartScores = typeScoresNonNull === 9 && instinctScoresNonNull === 3 && centerScoresNonNull === 3;
    const hasMinPages = extractedPageCount >= expectedPages;
    const hasCoreProfile = Boolean(parsedData?.primaryType || parsedData?.typeName || parsedData?.coreFear || parsedData?.coreDesire);
    const isComplete = hasMinPages && hasCoreProfile && (!requireChartScoresForComplete || hasAllChartScores);

    const incompleteReason = !hasMinPages
      ? `Extracted ${extractedPageCount} pages, expected at least ${expectedPages}`
      : !hasCoreProfile
        ? "Attached LLM-only parse missing core profile fields"
        : requireChartScoresForComplete && !hasAllChartScores
          ? "Chart numerics incomplete: one or more type, instinct, or center scores are null"
          : null;

    const rawScoreSnapshot = {
      ...typeScores,
      sexual: instinctScores.sexual,
      social: instinctScores.social,
      selfPreservation: instinctScores.selfPreservation,
      body: centerScores.body,
      heart: centerScores.heart,
      head: centerScores.head,
      happiness: parsedData?.strainLevels?.happiness,
      vocational: parsedData?.strainLevels?.vocational,
      interpersonal: parsedData?.strainLevels?.interpersonal,
      physical: parsedData?.strainLevels?.physical,
      environmental: parsedData?.strainLevels?.environmental,
      psychological: parsedData?.strainLevels?.psychological,
    };

    const parserWarnings = [];
    if (enablePythonCrossCheck && !verification?.available) {
      parserWarnings.push({
        message: "Python cross-check unavailable",
        details: verification?.details || verification?.reason || "unknown",
      });
    }
    if (verification?.available && verification?.mismatchCount > 0) {
      parserWarnings.push({
        message: "LLM/Python cross-check mismatches detected",
        details: verification.mismatchKeys.join(", "),
      });
    }
    const fallbackAppliedFields = Object.entries(verification?.fallbackApplied || {})
      .filter(([, applied]) => Boolean(applied))
      .map(([field]) => field);
    if (fallbackAppliedFields.length > 0) {
      parserWarnings.push({
        message: "Python fallback applied for missing LLM identity fields",
        details: fallbackAppliedFields.join(", "),
      });
    }
    const parseNoise =
      normalizeTextNoiseMetrics(verification?.noise) ||
      normalizeTextNoiseMetrics(verification?.python?.textNoise) ||
      null;
    if (parseNoise?.severity === "high") {
      parserWarnings.push({
        message: "High PDF text noise detected",
        details: `Noise score ${parseNoise.score}/100 (${parseNoise.controlNoisePer10kChars} per 10k chars).`,
      });
    }

    const verifiedDetectedTotalPages = Number.isFinite(Number(verification?.python?.pageCount))
      && Number(verification.python.pageCount) > 0
      ? Math.floor(Number(verification.python.pageCount))
      : extractedPageCount;
    const parseCoverage = buildParseCoverage({
      parsedPages: extractedPageCount,
      detectedTotalPages: verifiedDetectedTotalPages,
      minExpectedPages: expectedPages,
    });
    const preflightDiagnostics = buildParsePreflightDiagnostics({
      missingOpenAiEnvVars: preflightMissingOpenAiEnvVars,
      missingDocIntelEnvVars: preflightMissingDocIntelEnvVars,
      missingLlamaEnvVars: preflightMissingLlamaEnvVars,
      docIntelRequiredForRun,
      llamaRequiredForRun,
    });
    const verificationSummary = buildVerificationSummary(verification);
    const parseState = isComplete ? "complete" : "incomplete";
    const parseReason = incompleteReason ? String(incompleteReason) : null;

    return {
      ...parsedData,
      _parseStatus: isComplete ? "complete" : "incomplete",
      _parseState: parseState,
      _parseReason: parseReason,
      parseCoverage,
      verificationSummary,
      parseNoise,
      parseState,
      parseReason,
      _parseDiagnostics: {
        isComplete,
        incompleteReason,
        parseState,
        parseReason,
        completedAt: new Date().toISOString(),
        parserVersion: PARSER_VERSION,
        extraction: {
          pages: extractedPageCount,
          minExpectedPages: expectedPages,
          detectedTotalPages: verifiedDetectedTotalPages,
          sections: asArray(parsedData?.reportContent?.sections).length,
          method: extractionMethod,
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
        noise: parseNoise,
        rag: summarizeCanonicalRagDiagnostics(lastKnownCanonicalRag),
        extractionLearning: summarizeExtractionLearningDiagnostics(lastKnownExtractionLearning),
        rawScores: rawScoreSnapshot,
        verification,
        fieldPageProvenance: parsedData?.fieldPageProvenance || {},
        warnings: parserWarnings,
        errors: [],
        preflight: preflightDiagnostics,
      },
    };
  } catch (error) {
    console.error("[parsePdf] Fatal error during agentic OCR parsing:", error);
    const parseReason = String(error?.message || "Unknown parse failure");
    const failureVerification =
      lastKnownVerification && typeof lastKnownVerification === "object"
        ? lastKnownVerification
        : {
          available: false,
          source: "python_extract_report_pdf",
          reason: "python_verification_not_run",
        };
    const parseCoverage = buildParseCoverage({
      parsedPages: lastKnownExtractedPageCount,
      detectedTotalPages: lastKnownExtractedPageCount || null,
      minExpectedPages: expectedPages,
    });
    const verificationSummary = buildVerificationSummary(failureVerification);
    const parseNoise =
      normalizeTextNoiseMetrics(failureVerification?.noise) ||
      normalizeTextNoiseMetrics(failureVerification?.python?.textNoise) ||
      null;
    const preflightDiagnostics = buildParsePreflightDiagnostics({
      missingOpenAiEnvVars: preflightMissingOpenAiEnvVars,
      missingDocIntelEnvVars: preflightMissingDocIntelEnvVars,
      missingLlamaEnvVars: preflightMissingLlamaEnvVars,
      docIntelRequiredForRun,
      llamaRequiredForRun,
    });
    return {
      _parseStatus: "incomplete",
      _parseState: "failed",
      _parseReason: parseReason,
      parseCoverage,
      verificationSummary,
      parseNoise,
      parseState: "failed",
      parseReason,
      _parseDiagnostics: {
        isComplete: false,
        incompleteReason: parseReason,
        parseState: "failed",
        parseReason,
        parserVersion: PARSER_VERSION,
        extraction: {
          pages: lastKnownExtractedPageCount,
          minExpectedPages: expectedPages,
          detectedTotalPages: lastKnownExtractedPageCount || null,
          method: "failed",
        },
        noise: parseNoise,
        verification: {
          ...failureVerification,
        },
        rag: summarizeCanonicalRagDiagnostics(lastKnownCanonicalRag),
        extractionLearning: summarizeExtractionLearningDiagnostics(lastKnownExtractionLearning),
        fieldPageProvenance: {},
        warnings: [],
        errors: [{ message: parseReason }],
        preflight: preflightDiagnostics,
      },
    };
  }
}

export {
  applyPythonVerificationFallbacksToParsedData,
  agenticOcrRepair,
  buildCanonicalRagContext,
  extractAttachedStructuredJson,
  extractMarkdownWithAzureDocIntel,
  extractTextWithLlamaParse,
  extractStructuredJsonFromRawText,
  extractLayoutHtmlWithPython,
  mergeStructuredObjects,
};
