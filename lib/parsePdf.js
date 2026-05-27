import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

// =====================================================================
// 1. Initialize the Azure Document Intelligence Client
// =====================================================================
const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

if (!endpoint || !key) {
  throw new Error("Missing Azure Document Intelligence environment variables.");
}

const documentClient = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

// =====================================================================
// 2. Main Parsing Function
// =====================================================================
export async function parsePdf(pdfBuffer, reportId) {
  console.log(`[parsePdf] Starting Document Intelligence extraction for ${reportId}...`);
  
  try {
    // Step A: Send the raw buffer to Azure Document Intelligence (Layout Model)
    // The prebuilt-layout model automatically finds paragraphs, reading order, and tables.
    const poller = await documentClient.beginAnalyzeDocument("prebuilt-layout", pdfBuffer);
    const { paragraphs, tables, pages } = await poller.pollUntilDone();
    
    console.log(`[parsePdf] ADI extracted ${pages.length} pages.`);

    // Step B: Clean the text and STRIP FOOTERS!
    // ADI automatically tags footers, headers, and page numbers with specific roles.
    const cleanParagraphs = paragraphs
      .filter(p => !['pageHeader', 'pageFooter', 'pageNumber'].includes(p.role))
      .map(p => p.content)
      .join('\n\n');

    // Step C: Convert visual grids/tables (like the Feedback Guide) into Markdown
    // This allows the LLM to easily read the row/column relationships
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

    // Step D: Combine clean text and tables
    const masterDocumentText = cleanParagraphs + '\n\n' + markdownTables;

    // =====================================================================
    // 3. The Azure OpenAI Extraction Pass
    // =====================================================================
    console.log(`[parsePdf] Sending cleaned text to Azure OpenAI for structured extraction...`);
    
    // NOTE: Call your existing Azure OpenAI logic here, but pass `masterDocumentText` 
    // instead of sending images. 
    
    /* const structuredData = await callAzureOpenAI(masterDocumentText);
    */

    // For demonstration, simulating the return structure
    const parseStatus = pages.length > 0 ? 'complete' : 'incomplete';

    return {
      reportId,
      parseStatus: parseStatus,
      reviewStatus: 'ready',
      parsePages: pages.length,
      parseMinExpectedPages: 42,
      // data: structuredData
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