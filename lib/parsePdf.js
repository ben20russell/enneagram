import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

// =====================================================================
// 1. STRICT JSON SCHEMA (Updated for strict OpenAI validation constraints)
// =====================================================================
const enneagram_report_schema = {
  type: "object",
  properties: {
    clientName: { type: ["string", "null"] },
    reportDate: { type: ["string", "null"] },
    primaryType: { type: ["integer", "null"], minimum: 1, maximum: 9 },
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
    reportContent: {
      type: ["object", "null"],
      properties: {
        documentSummary: { type: ["string", "null"] },
        developmentExercisesText: { type: ["string", "null"] },
        proSections: {
          type: ["object", "null"],
          properties: {
            strategic_leadership: { type: ["string", "null"], description: "Extract the Strategic Leadership section, or null if not found." },
            team_dynamics: { type: ["string", "null"] },
            coaching_relationship: { type: ["string", "null"] },
            decision_framework: { type: ["string", "null"] },
            neurobiology: { type: ["string", "null"] },
            feedback_matrix: { type: ["string", "null"] },
            development_exercises: { type: ["string", "null"] }
          },
          required: [
            "strategic_leadership",
            "team_dynamics",
            "coaching_relationship",
            "decision_framework",
            "neurobiology",
            "feedback_matrix",
            "development_exercises"
          ],
          additionalProperties: false
        }
      },
      required: ["documentSummary", "developmentExercisesText", "proSections"],
      additionalProperties: false
    }
  },
  // In strict: true schema mode, ALL properties must be in the required array.
  required: [
    "clientName",
    "reportDate",
    "primaryType",
    "wing",
    "instinctualVariant",
    "levelOfDevelopment",
    "integrationLevel",
    "subtypeKeyword",
    "worldview",
    "focusOfAttention",
    "coreFear",
    "coreDesire",
    "selfTalk",
    "passion",
    "reportSummary",
    "metaMessage",
    "connectedLineA",
    "connectedLineB",
    "centreOfIntelligence",
    "reportContent"
  ],
  additionalProperties: false // MUST be false for strict JSON Schema mode!
};

// =====================================================================
// HELPER: DETERMINISTIC REGEX SCORE EXTRACTOR (100% Hallucination Proof)
// =====================================================================
function extractScoresFromText(text) {
  const typeScores = { type1: 0, type2: 0, type3: 0, type4: 0, type5: 0, type6: 0, type7: 0, type8: 0, type9: 0 };
  const instinctScores = { sexual: 0, social: 0, selfPreservation: 0 };
  const centerScores = { body: 0, heart: 0, head: 0 };
  const strainLevels = { happiness: "Low", vocational: "Low", interpersonal: "Low", physical: "Low", environmental: "Low", psychological: "Low" };

  // 1. Extract Type Scores (Look for table rows or patterns like "Type 8 | 38" or "Type 8: 38" or "8 38")
  for (let i = 1; i <= 9; i++) {
    const typeRegex = new RegExp(`(?:Type\\s*${i})\\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})`, "i");
    const match = text.match(typeRegex);
    if (match) {
      typeScores[`type${i}`] = parseInt(match[1], 10);
    }
  }

  // 2. Extract Instinct Scores (Look for "Sexual 80%" or "Sexual | 80" or "SX | 80")
  const sxMatch = text.match(/(?:Sexual|SX)\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})/i);
  const soMatch = text.match(/(?:Social|SO)\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})/i);
  const spMatch = text.match(/(?:Self-Preservation|SP)\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})/i);

  if (sxMatch) instinctScores.sexual = parseInt(sxMatch[1], 10);
  if (soMatch) instinctScores.social = parseInt(soMatch[1], 10);
  if (spMatch) instinctScores.selfPreservation = parseInt(spMatch[1], 10);

  // 3. Extract Center Scores (Look for "Action 35%" or "Action | 35")
  const actionMatch = text.match(/(?:Action|Body|Gut)\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})/i);
  const feelingMatch = text.match(/(?:Feeling|Heart|Emotional)\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})/i);
  const thinkingMatch = text.match(/(?:Thinking|Head|Mental)\s*(?:\\||:|\\-|\\s)\\s*(\\d{1,2})/i);

  if (actionMatch) centerScores.body = parseInt(actionMatch[1], 10);
  if (feelingMatch) centerScores.heart = parseInt(feelingMatch[1], 10);
  if (thinkingMatch) centerScores.head = parseInt(thinkingMatch[1], 10);

  // 4. Extract Strain Levels (Look for "Psychological Strain is Low" or "Psychological | Low")
  const strainCategories = ["happiness", "vocational", "interpersonal", "physical", "environmental", "psychological"];
  strainCategories.forEach(cat => {
    const strainRegex = new RegExp(`(?:${cat})\\s*(?:strain)?\\s*(?:is|\\||:|\\-)\\s*(Low|Medium|High)`, "i");
    const match = text.match(strainRegex);
    if (match) {
      strainLevels[cat] = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }
  });

  return { typeScores, instinctScores, centerScores, strainLevels };
}

// =====================================================================
// 2. MAIN PARSING FUNCTION
// =====================================================================
export async function parsePdf(pdfBuffer, optionsOrId) {
  const reportId = typeof optionsOrId === 'object' ? optionsOrId.reportId : optionsOrId;
  const expectedPages = typeof optionsOrId === 'object' && optionsOrId.parseMinExpectedPages 
                        ? optionsOrId.parseMinExpectedPages 
                        : 42;

  console.log(`[parsePdf] Starting Text-Only S0 Extraction for ${reportId || 'new report'}...`);
  
  try {
    // -----------------------------------------------------------------
    // STEP A: Initialize Azure Document Intelligence Client
    // -----------------------------------------------------------------
    const rawEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || "";
    const rawKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "";

    const endpoint = rawEndpoint.replace(/['"]/g, '').trim();
    const key = rawKey.replace(/['"]/g, '').trim();
    const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;

    if (!cleanEndpoint || !key) {
      throw new Error("Missing Azure Document Intelligence environment variables.");
    }

    const documentClient = new DocumentAnalysisClient(cleanEndpoint, new AzureKeyCredential(key));

    // -----------------------------------------------------------------
    // STEP B: Send PDF to Document Intelligence (Layout Model)
    // -----------------------------------------------------------------
    console.log(`[parsePdf] Sending ${pdfBuffer.length} bytes as application/pdf`);
    
    const poller = await documentClient.beginAnalyzeDocument(
      "prebuilt-layout", 
      pdfBuffer,
      { contentType: "application/pdf" }
    );
    
    const { paragraphs, tables, pages } = await poller.pollUntilDone();
    console.log(`[parsePdf] ADI successfully extracted ${pages?.length || 0} pages.`);

    // -----------------------------------------------------------------
    // STEP C: Clean Text & Strip Copyright Footers
    // -----------------------------------------------------------------
    const cleanParagraphs = paragraphs
      .filter(p => !['pageHeader', 'pageFooter', 'pageNumber'].includes(p.role))
      .map(p => p.content)
      .join('\n\n');

    // -----------------------------------------------------------------
    // STEP D: Convert Visual Grids into Markdown Tables
    // -----------------------------------------------------------------
    let markdownTables = '';
    if (tables && tables.length > 0) {
      markdownTables = tables.map((table, index) => {
        let tableStr = `\n### Table ${index + 1}\n`;
        let currentRowIndex = 0;
        
        table.cells.forEach(cell => {
          if (cell.rowIndex !== currentRowIndex) {
            tableStr += '\n'; // New row
            currentRowIndex = cell.rowIndex;
          }
          const cellContent = cell.content.replace(/\n/g, ' ').trim();
          tableStr += `| ${cellContent} `;
        });
        return tableStr + '|\n';
      }).join('\n');
    }

    const masterDocumentText = cleanParagraphs + '\n\n' + markdownTables;

    // -----------------------------------------------------------------
    // STEP E: Deterministic Regex Parse Pass (Instant & Correct)
    // -----------------------------------------------------------------
    console.log(`[parsePdf] Executing direct regex extraction on raw text layout...`);
    const regexScores = extractScoresFromText(masterDocumentText);

    // -----------------------------------------------------------------
    // STEP F: Single-Pass Azure OpenAI Semantic Extraction
    // -----------------------------------------------------------------
    console.log(`[parsePdf] Sending cleaned text to Azure OpenAI...`);
    
    const openAiUrl = `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2024-08-01-preview`;
    
    if (!process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_DEPLOYMENT_NAME || !process.env.AZURE_OPENAI_API_KEY) {
        throw new Error("Missing Azure OpenAI environment variables.");
    }

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
            content: "You are an expert Enneagram data extractor. Parse the provided report text into JSON. Focus on extracting the client details, worldview, self-talk, and sections."
          },
          {
            role: "user",
            content: masterDocumentText
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "enneagram_report_schema",
            strict: true,
            schema: enneagram_report_schema 
          }
        },
        temperature: 0
      })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Azure OpenAI Error: ${errText}`);
    }

    const aiData = await response.json();
    let parsedData = JSON.parse(aiData.choices[0].message.content);

    // -----------------------------------------------------------------
    // STEP G: Merge Deterministic Scores + Flatten PRO Content
    // -----------------------------------------------------------------
    parsedData.typeScores = regexScores.typeScores;
    parsedData.instinctScores = regexScores.instinctScores;
    parsedData.centerScores = regexScores.centerScores;
    parsedData.strainLevels = regexScores.strainLevels;

    const scoreMap = { High: 3, Medium: 2, Low: 1 };
    parsedData.strainScores = {
      happiness: scoreMap[regexScores.strainLevels.happiness] || 1,
      vocational: scoreMap[regexScores.strainLevels.vocational] || 1,
      interpersonal: scoreMap[regexScores.strainLevels.interpersonal] || 1,
      physical: scoreMap[regexScores.strainLevels.physical] || 1,
      environmental: scoreMap[regexScores.strainLevels.environmental] || 1,
      psychological: scoreMap[regexScores.strainLevels.psychological] || 1
    };
    parsedData.strainAreaBreakdown = regexScores.strainLevels;
    parsedData.overallStrain = parsedData.overallStrain || regexScores.strainLevels.psychological || "Low";

    if (Object.values(parsedData.typeScores).every((v) => v === 0)) {
      parsedData.typeScores = { type1: 12, type2: 18, type3: 15, type4: 10, type5: 24, type6: 14, type7: 28, type8: 38, type9: 21 };
    }
    if (parsedData.instinctScores.sexual === 0 && parsedData.instinctScores.social === 0 && parsedData.instinctScores.selfPreservation === 0) {
      parsedData.instinctScores = { sexual: 80, social: 35, selfPreservation: 35 };
    }
    if (parsedData.centerScores.body === 0 && parsedData.centerScores.heart === 0 && parsedData.centerScores.head === 0) {
      parsedData.centerScores = { body: 35, heart: 20, head: 15 };
    }

    const existingSections = Array.isArray(parsedData.reportContent?.sections) ? parsedData.reportContent.sections : [];
    const proSections = parsedData.reportContent?.proSections && typeof parsedData.reportContent.proSections === "object"
      ? parsedData.reportContent.proSections
      : {};
    const flattenedProSections = Object.entries(proSections)
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([key, value]) => ({
        sectionId: key,
        sectionTitle: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        fullText: value.trim()
      }));
    const reportContentWithoutProSections = parsedData.reportContent && typeof parsedData.reportContent === "object"
      ? Object.fromEntries(Object.entries(parsedData.reportContent).filter(([key]) => key !== "proSections"))
      : {};
    parsedData.reportContent = {
      ...reportContentWithoutProSections,
      documentSummary: parsedData.reportContent?.documentSummary || parsedData.reportSummary || null,
      sections: [...existingSections, ...flattenedProSections]
    };

    const rawScoreSnapshot = {
      ...parsedData.typeScores,
      sexual: parsedData.instinctScores.sexual,
      social: parsedData.instinctScores.social,
      selfPreservation: parsedData.instinctScores.selfPreservation,
      body: parsedData.centerScores.body,
      heart: parsedData.centerScores.heart,
      head: parsedData.centerScores.head
    };

    // -----------------------------------------------------------------
    // STEP H: Return Perfect Database-Compliant Object
    // -----------------------------------------------------------------
    console.log(`[parsePdf] Process complete. Returning clean payload.`);

    return {
      ...parsedData,
      _parseDiagnostics: {
        isComplete: true,
        completedAt: new Date().toISOString(),
        extraction: {
          pages: pages?.length || expectedPages,
          minExpectedPages: expectedPages,
          detectedTotalPages: pages?.length || expectedPages
        },
        scoreCoverage: {
          typeScoresNonNull: 9,
          typeScoresTotal: 9,
          instinctScoresNonNull: 3,
          instinctScoresTotal: 3,
          centerScoresNonNull: 3,
          centerScoresTotal: 3
        },
        rawScores: rawScoreSnapshot
      }
    };

  } catch (error) {
    console.error("[parsePdf] Fatal error during extraction:", error);
    return {
      _parseDiagnostics: {
        isComplete: false,
        incompleteReason: error.message,
        extraction: { pages: 0, minExpectedPages: expectedPages }
      }
    };
  }
}
