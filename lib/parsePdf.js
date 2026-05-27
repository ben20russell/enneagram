import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

// =====================================================================
// Main Parsing Function
// =====================================================================
export async function parsePdf(pdfBuffer, reportId) {
  console.log(`[parsePdf] Starting Document Intelligence extraction for ${reportId}...`);
  
  try {
    // 1. Initialize the Client INSIDE the function to guarantee scope
    const rawEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || "";
    const rawKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "";

    const endpoint = rawEndpoint.replace(/["']/g, '').trim();
    const key = rawKey.replace(/["']/g, '').trim();
    const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;

    if (!cleanEndpoint || !key) {
      throw new Error("Missing Azure Document Intelligence environment variables.");
    }

    const documentClient = new DocumentAnalysisClient(cleanEndpoint, new AzureKeyCredential(key));

    // 2. Send the raw buffer, explicitly as a PDF
    console.log(`[parsePdf] Sending ${pdfBuffer.length} bytes as application/pdf`);
    
    const poller = await documentClient.beginAnalyzeDocument(
      "prebuilt-layout", 
      pdfBuffer,
      {
        contentType: "application/pdf"
      }
    );
    
    const { paragraphs, tables, pages } = await poller.pollUntilDone();
    
    console.log(`[parsePdf] ADI extracted ${pages?.length || 0} pages.`);

    // 3. Clean the text and STRIP FOOTERS
    const cleanParagraphs = paragraphs
      .filter(p => !['pageHeader', 'pageFooter', 'pageNumber'].includes(p.role))
      .map(p => p.content)
      .join('\n\n');

    // 4. Convert visual grids/tables into Markdown
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

    // 5. Combine clean text and tables
    const masterDocumentText = cleanParagraphs + '\n\n' + markdownTables;

    // =====================================================================
    // 6. Azure OpenAI Semantic Extraction Pass
    // =====================================================================
    console.log(`[parsePdf] Sending cleaned text to Azure OpenAI...`);
    
    // --> PUT YOUR EXISTING AZURE OPENAI FETCH LOGIC HERE <--
    // Make sure to pass `masterDocumentText` to the LLM instead of images.
    
    // Placeholder return until OpenAI logic is pasted
    return {
      reportId,
      parseStatus: pages.length > 0 ? 'complete' : 'incomplete',
      reviewStatus: 'ready',
      parsePages: pages.length,
      parseMinExpectedPages: 42,
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
