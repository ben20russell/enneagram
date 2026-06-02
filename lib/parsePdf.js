import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LOCAL_PYTHON_MAX_BUFFER_BYTES = 24 * 1024 * 1024;
const PARSER_VERSION = "attached-single-pass-v1";

const ATTACHED_JSON_SYSTEM_PROMPT = `
You are an expert Enneagram coach and data analyst.
I will provide raw text extracted from an iEQ9 Individual Professional Enneagram Report.

Your task is to parse this raw text and output a structured JSON object.

CRITICAL INSTRUCTIONS:
1. Do not hallucinate data. If a metric is missing, use null or an empty string.
2. Keep summaries concise (1-2 sentences max per field).
3. Output ONLY valid JSON matching this structure:
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

function normalizeWhitespace(value) {
  return String(value || "").replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
}

function stringOrNull(value) {
  const normalized = normalizeWhitespace(value);
  return normalized.length ? normalized : null;
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
  if (normalized === "High") return 80;
  if (normalized === "Medium") return 55;
  if (normalized === "Low") return 25;
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

function buildRawTextFromPages(pages) {
  return asArray(pages)
    .map((page) => normalizeWhitespace(page?.extractedText || ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function buildOverridePages(rawText, pageCount) {
  const text = normalizeWhitespace(rawText || "");
  const count = Number.isFinite(Number(pageCount)) && Number(pageCount) > 0 ? Math.floor(Number(pageCount)) : 1;
  return Array.from({ length: count }, (_, index) => ({
    pageNumber: index + 1,
    extractedText: index === 0 ? text : "",
  }));
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
    return asArray(payload?.pages)
      .map((page, idx) => ({
        pageNumber: Number.isFinite(Number(page?.pageNumber)) ? Math.floor(Number(page.pageNumber)) : idx + 1,
        extractedText: String(page?.extractedText || ""),
      }))
      .filter((page) => Number.isFinite(page.pageNumber) && page.pageNumber > 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractAttachedStructuredJson({
  openAiUrl,
  apiKey,
  rawText,
}) {
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
          content: ATTACHED_JSON_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Here is the raw PDF text to parse:\n\n${rawText}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`Azure OpenAI Error: ${await response.text()}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Azure OpenAI response did not include JSON content");
  }
  return JSON.parse(content);
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

  const primaryType = Number.isFinite(Number(core?.type_number)) ? Number(core.type_number) : null;
  const typeName = stringOrNull(core?.type_name);
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

  return {
    clientName: stringOrNull(client?.name),
    reportDate: stringOrNull(client?.date),
    primaryType,
    typeName,
    core_type: primaryType,
    core_type_name: typeName,
    primaryTypeName: typeName,
    typeTitle: typeName,
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
    strain_levels,
    strain_scores,
    developmentExercises,
    development_exercises: developmentExercises,
    feedbackGuideMatrix,
    teamStageBreakdown,
    coachingRelationship,
    reportSummary: `Attached single-pass extraction completed for ${reportId || "uploaded report"}.`,
    reportContent: {
      documentSummary: `Extracted ${pageSnapshots.length} pages using attached single-pass parser.`,
      developmentExercisesText: developmentExercises.join("\n\n"),
      developmentExercises,
      development_exercises: developmentExercises,
      sections,
      pages: pageSnapshots,
    },
    typeScores,
    instinctScores,
    attachedProfile: structured,
    spreadsheetFocuses: {
      communicationDynamics: serializeObject(communication),
      decisionMaking: serializeObject(decision),
      leadershipAndManagement: serializeObject(leadership),
      conflictAndTriggers: serializeObject(conflict),
      teamBehaviour: serializeObject(team),
      coachingRelationshipCopy: coachingRelationship.join(" ").trim() || null,
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

  console.log(`[parsePdf] Starting attached single-pass parsing for ${reportId || "new report"}...`);

  try {
    const endpoint = String(process.env.AZURE_OPENAI_ENDPOINT || "").replace(/['"]/g, "").trim().replace(/\/$/, "");
    const deployment = String(process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "").replace(/['"]/g, "").trim();
    const apiKey = String(process.env.AZURE_OPENAI_API_KEY || "").replace(/['"]/g, "").trim();
    if (!endpoint || !deployment || !apiKey) {
      throw new Error("Missing Azure OpenAI environment variables.");
    }

    const rawTextOverride = stringOrNull(parseOptions?.rawTextOverride);
    const pageCountOverride = Number.isFinite(Number(parseOptions?.pageCountOverride))
      ? Math.max(1, Math.floor(Number(parseOptions.pageCountOverride)))
      : null;
    const extractedPages = rawTextOverride
      ? buildOverridePages(rawTextOverride, pageCountOverride || 1)
      : await extractPdfPagesWithPython(pdfBuffer);
    const extractedPageCount = extractedPages.length;
    const rawText = buildRawTextFromPages(extractedPages);
    if (!rawText) {
      throw new Error("No extractable PDF text found.");
    }

    console.log("[parsePdf] Extracted raw text pages for attached flow.", {
      pages: extractedPageCount,
      chars: rawText.length,
      parserVersion: PARSER_VERSION,
    });

    const openAiUrl = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-08-01-preview`;
    const structured = await extractAttachedStructuredJson({
      openAiUrl,
      apiKey,
      rawText,
    });
    const parsedData = mapAttachedToLegacyPayload({
      structured,
      pages: extractedPages,
      reportId,
    });

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
        ? "Attached single-pass parse missing core profile fields"
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

    return {
      ...parsedData,
      _parseStatus: isComplete ? "complete" : "incomplete",
      _parseDiagnostics: {
        isComplete,
        incompleteReason,
        completedAt: new Date().toISOString(),
        parserVersion: PARSER_VERSION,
        extraction: {
          pages: extractedPageCount,
          minExpectedPages: expectedPages,
          detectedTotalPages: extractedPageCount,
          sections: asArray(parsedData?.reportContent?.sections).length,
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
        rawScores: rawScoreSnapshot,
      },
    };
  } catch (error) {
    console.error("[parsePdf] Fatal error during attached single-pass parsing:", error);
    return {
      _parseStatus: "incomplete",
      _parseDiagnostics: {
        isComplete: false,
        incompleteReason: error.message,
        parserVersion: PARSER_VERSION,
        extraction: {
          pages: 0,
          minExpectedPages: expectedPages,
        },
      },
    };
  }
}
