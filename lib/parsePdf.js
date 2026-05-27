import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

// =====================================================================
// 1. YOUR STRICT JSON SCHEMA
// =====================================================================
// Paste your full schema here. Remember to include the PRO sections 
// (strategic_leadership, team_dynamics, etc.) with type: ["string", "null"]
const enneagram_report_schema = {
  type: "object",
  properties: {
    // ... PASTE YOUR EXISTING PROPERTIES HERE ...
  },
  required: [
    // ... PASTE YOUR EXISTING REQUIRED ARRAY HERE ...
  ],
  additionalProperties: false
};

// =====================================================================
// 2. MAIN PARSING FUNCTION
// =====================================================================
export async function parsePdf(pdfBuffer, reportId) {
  console.log(`[parsePdf] Starting Document Intelligence extraction for ${reportId}...`);
  
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
    
    const { paragraphs = [], tables = [], pages = [] } = await poller.pollUntilDone();
    console.log(`[parsePdf] ADI extracted ${pages?.length || 0} pages.`);

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
          // Clean out newlines within cells to keep markdown formatting intact
          const cellContent = cell.content.replace(/\n/g, ' ').trim();
          tableStr += `| ${cellContent} `;
        });
        return tableStr + '|\n';
      }).join('\n');
    }

    // Combine for the LLM
    const masterDocumentText = cleanParagraphs + '\n\n' + markdownTables;

    // -----------------------------------------------------------------
    // STEP E: Single-Pass Azure OpenAI Semantic Extraction
    // -----------------------------------------------------------------
    console.log(`[parsePdf] Sending cleaned text to Azure OpenAI...`);
    
    const hasAzureOpenAiConfig =
      Boolean(process.env.AZURE_OPENAI_ENDPOINT) &&
      Boolean(process.env.AZURE_OPENAI_DEPLOYMENT_NAME) &&
      Boolean(process.env.AZURE_OPENAI_API_KEY);

    if (!hasAzureOpenAiConfig) {
      console.log("[parsePdf] Azure OpenAI env vars missing; returning ADI-only parse result.");
      return {
        reportId,
        parseStatus: pages.length > 0 ? 'complete' : 'incomplete',
        reviewStatus: 'ready',
        parsePages: pages.length,
        parseMinExpectedPages: 42,
      };
    }

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
            content: "You are an expert data extractor. Map the provided Enneagram report text into the strict JSON schema. The text includes Markdown tables representing visual grids (like the Feedback Guide). Ensure you extract the data from those tables accurately."
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
    const parsedData = JSON.parse(aiData.choices[0].message.content);

    // -----------------------------------------------------------------
    // STEP F: Data Formatting & Fallbacks
    // -----------------------------------------------------------------
    // Map visual gauge strings ("HIGH", "MEDIUM") to numbers to fix UI bugs
    const scoreMap = { "HIGH": 3, "MEDIUM": 2, "LOW": 1 };
    
    // Safely apply transformations if fields exist in the schema
    if (parsedData.actionScore && typeof parsedData.actionScore === 'string') {
        parsedData.actionScore = scoreMap[parsedData.actionScore.toUpperCase()] || 1;
    }
    if (parsedData.feelingScore && typeof parsedData.feelingScore === 'string') {
        parsedData.feelingScore = scoreMap[parsedData.feelingScore.toUpperCase()] || 1;
    }
    if (parsedData.thinkingScore && typeof parsedData.thinkingScore === 'string') {
        parsedData.thinkingScore = scoreMap[parsedData.thinkingScore.toUpperCase()] || 1;
    }
    if (parsedData.overallStrain && typeof parsedData.overallStrain === 'string') {
        parsedData.overallStrain = scoreMap[parsedData.overallStrain.toUpperCase()] || 1;
    }

    console.log(`[parsePdf] Success! Returning complete payload.`);

    // Return the final, complete payload
    return {
      reportId,
      parseStatus: pages.length > 0 ? 'complete' : 'incomplete',
      reviewStatus: 'ready',
      parsePages: pages.length,
      parseMinExpectedPages: 42,
      data: parsedData
    };

  } catch (error) {
    console.error("[parsePdf] Fatal error during extraction:", error);
    return {
      reportId,
      parseStatus: 'incomplete',
      reviewStatus: 'needs_review',
      error: error.message
    };
  }
}
