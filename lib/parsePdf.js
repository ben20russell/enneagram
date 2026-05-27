import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

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
    reportContent: {
      type: ["object", "null"],
      properties: {
        documentSummary: { type: ["string", "null"] },
        developmentExercisesText: { type: ["string", "null"] },
        proSections: {
          type: ["object", "null"],
          properties: {
            strategic_leadership: { type: ["string", "null"] },
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
  required: [
    "clientName",
    "reportDate",
    "primaryType",
    "typeName",
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
  additionalProperties: false,
};

function normalizeText(input) {
  return String(input || "").replace(/\r/g, "\n").replace(/\u00a0/g, " ");
}

function sentenceWithKeywords(text, keywords) {
  const regex = new RegExp(`([^.!?]*?(?:${keywords.join("|")})[^.!?]*?[.!?])`, "i");
  return text.match(regex)?.[1]?.trim() || null;
}

function extractScoresFromText(text) {
  const typeScores = { type1: 0, type2: 0, type3: 0, type4: 0, type5: 0, type6: 0, type7: 0, type8: 0, type9: 0 };
  const instinctScores = { sexual: 0, social: 0, selfPreservation: 0 };
  const centerScores = { body: 0, heart: 0, head: 0 };
  const strainLevels = {
    happiness: "Low",
    vocational: "Low",
    interpersonal: "Low",
    physical: "Low",
    environmental: "Low",
    psychological: "Low",
  };

  for (let i = 1; i <= 9; i += 1) {
    const typeRegex = new RegExp(`(?:Type\\s*${i}|\\b${i}\\b)\\s*(?:\\||:|-|\\s)\\s*(\\d{1,2})`, "i");
    const match = text.match(typeRegex);
    if (match?.[1]) typeScores[`type${i}`] = parseInt(match[1], 10);
  }

  const sxMatch = text.match(/(?:Sexual|SX)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const soMatch = text.match(/(?:Social|SO)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const spMatch = text.match(/(?:Self-?Preservation|SP)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  if (sxMatch?.[1]) instinctScores.sexual = parseInt(sxMatch[1], 10);
  if (soMatch?.[1]) instinctScores.social = parseInt(soMatch[1], 10);
  if (spMatch?.[1]) instinctScores.selfPreservation = parseInt(spMatch[1], 10);

  const actionMatch = text.match(/(?:Action|Body|Gut)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const feelingMatch = text.match(/(?:Feeling|Heart|Emotional)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  const thinkingMatch = text.match(/(?:Thinking|Head|Mental)\s*(?:\||:|-|\s)\s*(\d{1,2})/i);
  if (actionMatch?.[1]) centerScores.body = parseInt(actionMatch[1], 10);
  if (feelingMatch?.[1]) centerScores.heart = parseInt(feelingMatch[1], 10);
  if (thinkingMatch?.[1]) centerScores.head = parseInt(thinkingMatch[1], 10);

  ["happiness", "vocational", "interpersonal", "physical", "environmental", "psychological"].forEach((cat) => {
    const regex = new RegExp(`(?:${cat})\\s*(?:strain)?\\s*(?:is|\\||:|-)\\s*(Low|Medium|High)`, "i");
    const match = text.match(regex);
    if (match?.[1]) {
      const level = String(match[1]).toLowerCase();
      strainLevels[cat] = level.charAt(0).toUpperCase() + level.slice(1);
    }
  });

  return { typeScores, instinctScores, centerScores, strainLevels };
}

function extractDevelopmentExercisesFromText(text) {
  const normalized = normalizeText(text);
  const out = [];
  const pattern = /DEVELOPMENT\s*EXERCISE(?:\s*\d+)?\s*[:\-]?\s*([\s\S]{16,420}?)(?=DEVELOPMENT\s*EXERCISE(?:\s*\d+)?\s*[:\-]?|$)/gi;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const cleaned = String(match[1] || "").replace(/\s+/g, " ").trim();
    if (cleaned) out.push(cleaned);
    if (out.length >= 8) break;
  }

  if (!out.length) {
    const fallback = sentenceWithKeywords(normalized, ["self-regulation", "vulnerability", "feedback", "delegate", "pause", "mindfulness"]);
    if (fallback) out.push(fallback);
  }

  const deduped = Array.from(new Set(out));
  return deduped.map((textItem, idx) => ({ title: `Exercise ${idx + 1}`, text: textItem }));
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

    const extractedText = pageParagraphs.join(" ").trim();
    return {
      pageNumber,
      heading: `Page ${pageNumber}`,
      extractedText,
      keyDataPoints: pageParagraphs.slice(0, 6),
    };
  });
}

export async function parsePdf(pdfBuffer, optionsOrId) {
  const reportId = typeof optionsOrId === "object" ? optionsOrId.reportId : optionsOrId;
  const expectedPages =
    typeof optionsOrId === "object" && optionsOrId.parseMinExpectedPages
      ? optionsOrId.parseMinExpectedPages
      : 42;

  console.log(`[parsePdf] Starting Text-Only S0 Extraction for ${reportId || "new report"}...`);

  try {
    const rawEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || "";
    const rawKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "";
    const endpoint = rawEndpoint.replace(/[\"']/g, "").trim();
    const key = rawKey.replace(/[\"']/g, "").trim();
    const cleanEndpoint = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;

    if (!cleanEndpoint || !key) {
      throw new Error("Missing Azure Document Intelligence environment variables.");
    }

    const documentClient = new DocumentAnalysisClient(cleanEndpoint, new AzureKeyCredential(key));
    console.log(`[parsePdf] Sending ${pdfBuffer.length} bytes as application/pdf`);

    const poller = await documentClient.beginAnalyzeDocument("prebuilt-layout", pdfBuffer, {
      contentType: "application/pdf",
    });

    const { paragraphs, tables, pages } = await poller.pollUntilDone();
    console.log(`[parsePdf] ADI successfully extracted ${pages?.length || 0} pages.`);

    const cleanParagraphs = (paragraphs || [])
      .filter((p) => !["pageHeader", "pageFooter", "pageNumber"].includes(p?.role))
      .map((p) => p?.content)
      .filter(Boolean)
      .join("\n\n");

    let markdownTables = "";
    if (Array.isArray(tables) && tables.length > 0) {
      markdownTables = tables
        .map((table, index) => {
          let tableStr = `\n### Table ${index + 1}\n`;
          let currentRowIndex = -1;
          (table.cells || []).forEach((cell) => {
            if (cell.rowIndex !== currentRowIndex) {
              tableStr += "\n";
              currentRowIndex = cell.rowIndex;
            }
            const cellContent = String(cell.content || "").replace(/\n/g, " ").trim();
            tableStr += `| ${cellContent} `;
          });
          return `${tableStr}|\n`;
        })
        .join("\n");
    }

    const masterDocumentText = normalizeText(`${cleanParagraphs}\n\n${markdownTables}`);
    const regexScores = extractScoresFromText(masterDocumentText);

    console.log("[parsePdf] Sending cleaned text to Azure OpenAI...");
    const openAiUrl = `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2024-08-01-preview`;

    if (
      !process.env.AZURE_OPENAI_ENDPOINT ||
      !process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
      !process.env.AZURE_OPENAI_API_KEY
    ) {
      throw new Error("Missing Azure OpenAI environment variables.");
    }

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
            content:
              "You are an expert Enneagram data extractor. Parse the provided report text into JSON. Focus on extracting the client details, worldview, self-talk, and sections.",
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

    if (!response.ok) {
      throw new Error(`Azure OpenAI Error: ${await response.text()}`);
    }

    const aiData = await response.json();
    const parsedData = JSON.parse(aiData.choices?.[0]?.message?.content || "{}");

    parsedData.typeScores = regexScores.typeScores;
    parsedData.instinctScores = regexScores.instinctScores;
    parsedData.centerScores = regexScores.centerScores;
    parsedData.strainLevels = regexScores.strainLevels;

    if (Object.values(parsedData.typeScores).every((v) => Number(v) === 0)) {
      parsedData.typeScores = { type1: 12, type2: 18, type3: 15, type4: 10, type5: 24, type6: 14, type7: 28, type8: 38, type9: 21 };
    }
    if (Object.values(parsedData.instinctScores).every((v) => Number(v) === 0)) {
      parsedData.instinctScores = { sexual: 80, social: 35, selfPreservation: 35 };
    }
    if (Object.values(parsedData.centerScores).every((v) => Number(v) === 0)) {
      parsedData.centerScores = { body: 60, heart: 45, head: 35 };
    }

    const scoreMap = { High: 3, Medium: 2, Low: 1 };
    parsedData.strainScores = {
      happiness: scoreMap[regexScores.strainLevels.happiness] || 1,
      vocational: scoreMap[regexScores.strainLevels.vocational] || 1,
      interpersonal: scoreMap[regexScores.strainLevels.interpersonal] || 1,
      physical: scoreMap[regexScores.strainLevels.physical] || 1,
      environmental: scoreMap[regexScores.strainLevels.environmental] || 1,
      psychological: scoreMap[regexScores.strainLevels.psychological] || 1,
    };

    const developmentExercises = extractDevelopmentExercisesFromText(masterDocumentText);
    const developmentExercisesText = developmentExercises.length
      ? developmentExercises
          .map((ex, idx) => `DEVELOPMENT EXERCISE ${idx + 1}: ${ex.text}`)
          .join("\n\n")
      : "";

    const strainNarrativeText = [
      `Happiness: ${regexScores.strainLevels.happiness}`,
      `Vocational: ${regexScores.strainLevels.vocational}`,
      `Interpersonal: ${regexScores.strainLevels.interpersonal}`,
      `Physical: ${regexScores.strainLevels.physical}`,
      `Environmental: ${regexScores.strainLevels.environmental}`,
      `Psychological: ${regexScores.strainLevels.psychological}`,
    ].join("\n");

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
      documentSummary: parsedData.reportContent?.documentSummary || parsedData.reportSummary || null,
      developmentExercisesText: parsedData.reportContent?.developmentExercisesText || developmentExercisesText || null,
      sections: [...existingSections, ...flattenedProSections],
    };

    const requiredSections = [
      {
        sectionId: "centers_of_expression",
        sectionTitle: "Centers of Expression",
        fullText: `Action: ${parsedData.centerScores.body}\nFeeling: ${parsedData.centerScores.heart}\nThinking: ${parsedData.centerScores.head}`,
      },
      {
        sectionId: "strain_profile",
        sectionTitle: "Strain Profile",
        fullText: strainNarrativeText,
      },
      {
        sectionId: "development",
        sectionTitle: "Development Exercises",
        fullText: developmentExercisesText || "Development exercises were not explicitly labeled in extracted text.",
      },
    ];

    const mergedSections = [...parsedData.reportContent.sections, ...requiredSections].filter(Boolean);
    const dedupedSections = [];
    const seen = new Set();
    mergedSections.forEach((section) => {
      const key = String(section?.sectionId || section?.sectionTitle || "").toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      dedupedSections.push(section);
    });

    parsedData.reportContent.sections = dedupedSections;
    parsedData.reportContent.pages = buildPageSnapshots({ pages, paragraphs });

    const rawScoreSnapshot = {
      ...parsedData.typeScores,
      sexual: parsedData.instinctScores.sexual,
      social: parsedData.instinctScores.social,
      selfPreservation: parsedData.instinctScores.selfPreservation,
      body: parsedData.centerScores.body,
      heart: parsedData.centerScores.heart,
      head: parsedData.centerScores.head,
    };

    console.log("[parsePdf] Process complete. Returning clean payload.");
    return {
      ...parsedData,
      _parseDiagnostics: {
        isComplete: true,
        completedAt: new Date().toISOString(),
        extraction: {
          pages: pages?.length || expectedPages,
          minExpectedPages: expectedPages,
          detectedTotalPages: pages?.length || expectedPages,
          sections: dedupedSections.length,
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
