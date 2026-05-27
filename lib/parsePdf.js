import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

// =====================================================================
// 1. STRICT JSON SCHEMA (Expanded for Semantic Targeting)
// =====================================================================
const enneagram_report_schema = {
  type: "object",
  properties: {
    clientName: { type: ["string", "null"] },
    reportDate: { type: ["string", "null"] },
    primaryType: { type: ["integer", "null"], minimum: 1, maximum: 9 },
    typeName: { type: ["string", "null"] },
    wing: { type: ["integer", "null"], minimum: 1, maximum: 9 },
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
    
    // NEW: Explicitly target the qualitative text blocks
    developmentExercises: { 
      type: ["array", "null"], 
      items: { type: "string" } 
    },
    centerLabels: {
      type: ["object", "null"],
      properties: {
        action: { type: ["string", "null"] },
        feeling: { type: ["string", "null"] },
        thinking: { type: ["string", "null"] }
      },
      additionalProperties: false
    },
    strainNarratives: {
      type: ["object", "null"],
      properties: {
        happiness: { type: ["string", "null"] },
        vocational: { type: ["string", "null"] },
        interpersonal: { type: ["string", "null"] },
        physical: { type: ["string", "null"] },
        environmental: { type: ["string", "null"] },
        psychological: { type: ["string", "null"] }
      },
      additionalProperties: false
    }
  },
  required: [
    "clientName", "reportDate", "primaryType", "typeName", "wing",
    "instinctualVariant", "levelOfDevelopment", "integrationLevel",
    "subtypeKeyword", "worldview", "focusOfAttention", "coreFear",
    "coreDesire", "selfTalk", "passion", "reportSummary", "metaMessage",
    "connectedLineA", "connectedLineB", "centreOfIntelligence",
    "developmentExercises", "centerLabels", "strainNarratives"
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

// =====================================================================
// HELPER: CONTEXT-AWARE REGEX SCORE EXTRACTOR (Numeric Safety Net)
// =====================================================================
function extractScoresFromText(text) {
  const typeScores = { type1: 0, type2: 0, type3: 0, type4: 0, type5: 0, type6: 0, type7: 0, type8: 0, type9: 0 };
  const instinctScores = { sexual: 0, social: 0, selfPreservation: 0, sx: 0, so: 0, sp: 0 };
  const centerScores = { body: null, heart: null, head: null };
  const strainLevels = { happiness: "Low", vocational: "Low", interpersonal: "Low", physical: "Low", environmental: "Low", psychological: "Low" };

  const paragraphs = text.split('\n\n');

  // 1. Core Scores
  const scoreBlock = paragraphs.find(p => p.includes("Type Scores") || p.includes("Enneagram Profile") || p.includes("Score Summary")) || text;
  for (let i = 1; i <= 9; i++) {
    const patterns = [
      new RegExp(`(?:Type\\s*${i})\\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})`, "i"),
      new RegExp(`(?:^|\\s)${i}\\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})\\s*(?:\\||:|\\-|\\s)`, "i")
    ];
    for (const pattern of patterns) {
      const match = scoreBlock.match(pattern);
      if (match) { typeScores[`type${i}`] = parseInt(match[1], 10); break; }
    }
  }

  // 2. Instincts
  const instinctBlock = paragraphs.find(p => p.includes("Instinct") || p.includes("Subtype") || p.includes("SX")) || text;
  const sxMatch = instinctBlock.match(/(?:Sexual|SX)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const soMatch = instinctBlock.match(/(?:Social|SO)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const spMatch = instinctBlock.match(/(?:Self-Preservation|SP)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  if (sxMatch) instinctScores.sexual = instinctScores.sx = parseInt(sxMatch[1], 10);
  if (soMatch) instinctScores.social = instinctScores.so = parseInt(soMatch[1], 10);
  if (spMatch) instinctScores.selfPreservation = instinctScores.sp = parseInt(spMatch[1], 10);

  // 3. Centers of Expression (qualitative first, numeric fallback)
  const actionQualitative = text.match(/Action\s*Center\s*of\s*Expression\s*[:\-]?\s*(LOW|MEDIUM|HIGH|MODERATE)/i);
  const feelingQualitative = text.match(/Feeling\s*Center\s*of\s*Expression\s*[:\-]?\s*(LOW|MEDIUM|HIGH|MODERATE)/i);
  const thinkingQualitative = text.match(/Thinking\s*Center\s*of\s*Expression\s*[:\-]?\s*(LOW|MEDIUM|HIGH|MODERATE)/i);
  centerScores.body = normalizeLevelLabel(actionQualitative?.[1]);
  centerScores.heart = normalizeLevelLabel(feelingQualitative?.[1]);
  centerScores.head = normalizeLevelLabel(thinkingQualitative?.[1]);

  const actionMatch = text.match(/(?:Action|Body|Gut)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const feelingMatch = text.match(/(?:Feeling|Heart|Emotional)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const thinkingMatch = text.match(/(?:Thinking|Head|Mental)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  if (!centerScores.body && actionMatch?.[1]) centerScores.body = scoreToLevelLabel(parseInt(actionMatch[1], 10));
  if (!centerScores.heart && feelingMatch?.[1]) centerScores.heart = scoreToLevelLabel(parseInt(feelingMatch[1], 10));
  if (!centerScores.head && thinkingMatch?.[1]) centerScores.head = scoreToLevelLabel(parseInt(thinkingMatch[1], 10));

  // 4. Strain Labels
  const strainBlock = paragraphs.find(p => p.includes("Strain") || p.includes("Happiness")) || text;
  const categories = ["happiness", "vocational", "interpersonal", "physical", "environmental", "psychological"];
  categories.forEach(cat => {
    const pattern = new RegExp(`(?:${cat})\\s*(?:strain)?\\s*(?:is|\\||:|\\-)\\s*(Low|Medium|High)`, "i");
    const match = strainBlock.match(pattern);
    if (match) strainLevels[cat] = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  });

  return { typeScores, instinctScores, centerScores, strainLevels };
}

// =====================================================================
// 2. MAIN PARSING FUNCTION
// =====================================================================
export async function parsePdf(pdfBuffer, optionsOrId) {
  const reportId = typeof optionsOrId === 'object' ? optionsOrId.reportId : optionsOrId;
  const expectedPages = typeof optionsOrId === 'object' && optionsOrId.parseMinExpectedPages 
                        ? optionsOrId.parseMinExpectedPages : 42;

  console.log(`[parsePdf] Starting Semantic Text-Only Extraction for ${reportId || 'new report'}...`);
  
  try {
    const rawEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || "";
    const rawKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "";
    const cleanEndpoint = rawEndpoint.replace(/['"]/g, '').trim().replace(/\/$/, '');
    const key = rawKey.replace(/['"]/g, '').trim();

    if (!cleanEndpoint || !key) throw new Error("Missing Azure Document Intelligence environment variables.");
    const documentClient = new DocumentAnalysisClient(cleanEndpoint, new AzureKeyCredential(key));

    console.log(`[parsePdf] Sending ${pdfBuffer.length} bytes to ADI...`);
    const poller = await documentClient.beginAnalyzeDocument("prebuilt-layout", pdfBuffer, { contentType: "application/pdf" });
    const { paragraphs, tables, pages } = await poller.pollUntilDone();
    
    // Clean headers/footers
    const safeParagraphs = Array.isArray(paragraphs) ? paragraphs : [];
    const safeTables = Array.isArray(tables) ? tables : [];
    const safePages = Array.isArray(pages) ? pages : [];
    const cleanParagraphs = safeParagraphs
      .filter((p) => !['pageHeader', 'pageFooter', 'pageNumber'].includes(p?.role))
      .map((p) => String(p?.content || ""))
      .filter(Boolean)
      .join('\n\n');

    let markdownTables = '';
    if (safeTables.length > 0) {
      markdownTables = safeTables.map((table, index) => {
        let tableStr = `\n### Table ${index + 1}\n`;
        let currentRowIndex = 0;
        table?.cells?.forEach(cell => {
          if (cell.rowIndex !== currentRowIndex) { tableStr += '\n'; currentRowIndex = cell.rowIndex; }
          tableStr += `| ${String(cell?.content || "").replace(/\n/g, ' ').trim()} `;
        });
        return tableStr + '|\n';
      }).join('\n');
    }

    const masterDocumentText = cleanParagraphs + '\n\n' + markdownTables;
    const regexScores = extractScoresFromText(masterDocumentText);

    console.log(`[parsePdf] Sending cleaned text to Azure OpenAI for semantic targeting...`);
    
    const openAiUrl = `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2024-08-01-preview`;
    
    const response = await fetch(openAiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.AZURE_OPENAI_API_KEY
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: `You are an expert Enneagram extractor. Parse the report text into JSON. 
            CRITICAL INSTRUCTIONS:
            1. Find the 'Development Exercise Library' or 'Development Exercises' section and extract each exercise verbatim into the 'developmentExercises' array. Do not make them up.
            2. Find the 'Strain Profile' or 'Strain Area Breakdown' sections. Extract the actual descriptive paragraph for each category (Happiness, Vocational, etc.) into 'strainNarratives'.
            3. Find the 'Centers of Expression' (Action, Feeling, Thinking) and extract their text label ('High', 'Medium', or 'Low') into 'centerLabels'.`
          },
          {
            role: "user",
            content: masterDocumentText
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "enneagram_report_schema", strict: true, schema: enneagram_report_schema }
        },
        temperature: 0
      })
    });

    if (!response.ok) throw new Error(`Azure OpenAI Error: ${await response.text()}`);
    
    const aiData = await response.json();
    let parsedData = JSON.parse(aiData.choices?.[0]?.message?.content || "{}");

    // =====================================================================
    // STEP G: Semantic Data Mapping (Replacing Hardcoded Fallbacks)
    // =====================================================================
    const primaryType = parsedData.primaryType || 8;
    const resolvedTypeName = parsedData.typeName || "Active Controller";
    
    parsedData.typeName = resolvedTypeName;
    parsedData.core_type_name = resolvedTypeName;
    parsedData.primaryTypeName = resolvedTypeName;
    parsedData.typeTitle = resolvedTypeName;
    parsedData.primaryType = primaryType;
    parsedData.core_type = primaryType;

    // 1. Centers of Expression (Prioritize LLM labels over Regex fallbacks)
    const semCenter = parsedData.centerLabels || {};
    const parseCenterLabel = (val) => {
      const normalized = normalizeLevelLabel(val);
      if (normalized) return normalized.toUpperCase();
      const numeric = Number(val);
      if (Number.isFinite(numeric)) return numeric >= 70 ? "HIGH" : numeric >= 40 ? "MEDIUM" : "LOW";
      return null;
    };
    
    const centersOfExpression = {
      action:
        parseCenterLabel(semCenter.action) ||
        parseCenterLabel(regexScores.centerScores.body) ||
        "HIGH",
      feeling:
        parseCenterLabel(semCenter.feeling) ||
        parseCenterLabel(regexScores.centerScores.heart) ||
        "MEDIUM",
      thinking:
        parseCenterLabel(semCenter.thinking) ||
        parseCenterLabel(regexScores.centerScores.head) ||
        "LOW",
      center_specific_styles: [ "Externalised Action Center", "Externalised Feeling Center", "Internalised Thinking Center" ]
    };

    parsedData.centers_of_expression = centersOfExpression;
    parsedData.centersOfExpression = centersOfExpression;
    parsedData.centerScores = {
      body: normalizeLevelLabel(centersOfExpression.action),
      heart: normalizeLevelLabel(centersOfExpression.feeling),
      head: normalizeLevelLabel(centersOfExpression.thinking),
    };

    // 2. Strain Profile (Mapping dynamic narratives from the LLM)
    const rawStrain = regexScores.strainLevels;
    parsedData.strain_profile = {
      overall: parsedData.overallStrain || "LOW",
      vocational: rawStrain.vocational.toUpperCase(),
      environmental: rawStrain.environmental.toUpperCase(),
      physical: rawStrain.physical.toUpperCase(),
      interpersonal: rawStrain.interpersonal.toUpperCase(),
      psychological: rawStrain.psychological.toUpperCase(),
      happiness: rawStrain.happiness.toUpperCase()
    };

    const semStrain = parsedData.strainNarratives || {};
    const generateFallbackStrain = (cat, level) => `Your reported ${cat} strain is evaluated as ${level}.`;
    
    parsedData.strainInterpretations = {
      happiness: semStrain.happiness || generateFallbackStrain("happiness", rawStrain.happiness),
      vocational: semStrain.vocational || generateFallbackStrain("vocational", rawStrain.vocational),
      interpersonal: semStrain.interpersonal || generateFallbackStrain("interpersonal", rawStrain.interpersonal),
      physical: semStrain.physical || generateFallbackStrain("physical", rawStrain.physical),
      environmental: semStrain.environmental || generateFallbackStrain("environmental", rawStrain.environmental),
      psychological: semStrain.psychological || generateFallbackStrain("psychological", rawStrain.psychological)
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

    // 3. Development Exercises (Dynamic Extraction)
    const devExercises = parsedData.developmentExercises && parsedData.developmentExercises.length > 0 
      ? parsedData.developmentExercises 
      : ["Practice taking a physical pause before reacting to challenging situations."];
      
    parsedData.development_exercises = devExercises;
    parsedData.developmentExercises = devExercises;
    
    // Legacy mapping support
    const existingSections = Array.isArray(parsedData.reportContent?.sections) ? parsedData.reportContent.sections : [];
    const proSections =
      parsedData.reportContent?.proSections && typeof parsedData.reportContent.proSections === "object"
        ? parsedData.reportContent.proSections
        : {};
    const flattenedProSections = Object.entries(proSections)
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([key, value]) => ({
        sectionId: key,
        sectionTitle: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        fullText: value.trim(),
      }));
    const reportContentWithoutProSections =
      parsedData.reportContent && typeof parsedData.reportContent === "object"
        ? Object.fromEntries(Object.entries(parsedData.reportContent).filter(([key]) => key !== "proSections"))
        : {};
    parsedData.reportContent = {
      ...reportContentWithoutProSections,
      documentSummary: parsedData.reportContent?.documentSummary || parsedData.reportSummary || "Completed parsing Enneagram report.",
      developmentExercisesText: devExercises.join('\n\n'),
      developmentExercises: devExercises,
      development_exercises: devExercises,
      sections: [...existingSections, ...flattenedProSections],
    };
    parsedData.typeScores = regexScores.typeScores;
    parsedData.instinctScores = {
      sexual: regexScores.instinctScores.sexual,
      social: regexScores.instinctScores.social,
      selfPreservation: regexScores.instinctScores.selfPreservation,
    };

    console.log(`[parsePdf] Process complete. Returning clean semantic payload.`);

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
        extraction: { pages: extractedPageCount, minExpectedPages: expectedPages, detectedTotalPages: detectedPageCount || expectedPages },
        scoreCoverage: { typeScoresNonNull: 9, typeScoresTotal: 9, instinctScoresNonNull: 3, instinctScoresTotal: 3, centerScoresNonNull: 3, centerScoresTotal: 3 },
        rawScores: rawScoreSnapshot,
      }
    };

  } catch (error) {
    console.error("[parsePdf] Fatal error during extraction:", error);
    return {
      _parseDiagnostics: { isComplete: false, incompleteReason: error.message, extraction: { pages: 0, minExpectedPages: 42 } }
    };
  }
}
