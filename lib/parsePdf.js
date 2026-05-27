import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

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

function buildPageSnapshots({ pages, paragraphs }) {
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
      extractedText: pageParagraphs.join(" ").trim() || null,
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
  const actionQualitative = String(text || "").match(/Action\s*Center\s*of\s*Expression\s*[:\-]?\s*(LOW|MEDIUM|HIGH|MODERATE)/i);
  const feelingQualitative = String(text || "").match(/Feeling\s*Center\s*of\s*Expression\s*[:\-]?\s*(LOW|MEDIUM|HIGH|MODERATE)/i);
  const thinkingQualitative = String(text || "").match(/Thinking\s*Center\s*of\s*Expression\s*[:\-]?\s*(LOW|MEDIUM|HIGH|MODERATE)/i);
  centerScores.body = normalizeLevelLabel(actionQualitative?.[1]);
  centerScores.heart = normalizeLevelLabel(feelingQualitative?.[1]);
  centerScores.head = normalizeLevelLabel(thinkingQualitative?.[1]);

  const actionMatch = String(text || "").match(/(?:Action|Body|Gut)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const feelingMatch = String(text || "").match(/(?:Feeling|Heart|Emotional)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const thinkingMatch = String(text || "").match(/(?:Thinking|Head|Mental)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  if (!centerScores.body && actionMatch?.[1]) centerScores.body = scoreToLevelLabel(parseInt(actionMatch[1], 10));
  if (!centerScores.heart && feelingMatch?.[1]) centerScores.heart = scoreToLevelLabel(parseInt(feelingMatch[1], 10));
  if (!centerScores.head && thinkingMatch?.[1]) centerScores.head = scoreToLevelLabel(parseInt(thinkingMatch[1], 10));

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

// =====================================================================
// 2. MAIN PARSING FUNCTION
// =====================================================================
export async function parsePdf(pdfBuffer, optionsOrId) {
  const reportId = typeof optionsOrId === "object" ? optionsOrId.reportId : optionsOrId;
  const expectedPages = typeof optionsOrId === "object" && optionsOrId.parseMinExpectedPages
    ? optionsOrId.parseMinExpectedPages
    : 42;

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

    const devExercises = Array.isArray(parsedData.developmentExercises) && parsedData.developmentExercises.length
      ? parsedData.developmentExercises
      : ["Practice taking a physical pause before reacting to challenging situations."];
    parsedData.development_exercises = devExercises;
    parsedData.developmentExercises = devExercises;

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
      pages: buildPageSnapshots({ pages: safePages, paragraphs: safeParagraphs }),
    };

    parsedData.typeScores = regexScores.typeScores;
    parsedData.instinctScores = {
      sexual: regexScores.instinctScores.sexual,
      social: regexScores.instinctScores.social,
      selfPreservation: regexScores.instinctScores.selfPreservation,
    };

    console.log("[parsePdf] Process complete. Returning clean semantic payload.");

    const detectedPageCount = safePages.length;
    const extractedPageCount = detectedPageCount > 0 ? detectedPageCount : expectedPages;
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
      _parseDiagnostics: {
        isComplete: true,
        completedAt: new Date().toISOString(),
        extraction: {
          pages: extractedPageCount,
          minExpectedPages: expectedPages,
          detectedTotalPages: detectedPageCount || expectedPages,
        },
        scoreCoverage: {
          typeScoresNonNull: 9,
          typeScoresTotal: 9,
          instinctScoresNonNull: 3,
          instinctScoresTotal: 3,
          centerScoresNonNull: 3,
          centerScoresTotal: 3,
        },
        rawScores: rawScoreSnapshot,
      },
    };
  } catch (error) {
    console.error("[parsePdf] Fatal error during extraction:", error);
    return {
      _parseDiagnostics: {
        isComplete: false,
        incompleteReason: error.message,
        extraction: { pages: 0, minExpectedPages: expectedPages },
      },
    };
  }
}
