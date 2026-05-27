import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

function createDocumentClient() {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !key) {
    throw new Error("Missing Azure Document Intelligence environment variables.");
  }

  return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
}

function resolveParseContext(reportIdOrOptions) {
  if (reportIdOrOptions && typeof reportIdOrOptions === "object") {
    const reportId = String(reportIdOrOptions.reportId || "").trim() || null;
    return { reportId };
  }
  return { reportId: reportIdOrOptions ?? null };
}

// =====================================================================
// 2. Main Parsing Function
// =====================================================================
export async function parsePdf(pdfBuffer, reportIdOrOptions) {
  const { reportId } = resolveParseContext(reportIdOrOptions);
  console.log(`[parsePdf] Starting Document Intelligence extraction for ${reportId}...`);

  try {
    const documentClient = createDocumentClient();
    // Step A: Send the raw buffer to Azure Document Intelligence (Layout Model)
    // The prebuilt-layout model automatically finds paragraphs, reading order, and tables.
    const poller = await documentClient.beginAnalyzeDocument("prebuilt-layout", pdfBuffer);
    const { paragraphs, tables, pages } = await poller.pollUntilDone();
    const paragraphList = Array.isArray(paragraphs) ? paragraphs : [];
    const tableList = Array.isArray(tables) ? tables : [];
    const pageList = Array.isArray(pages) ? pages : [];

    console.log(`[parsePdf] ADI extracted ${pageList.length} pages.`);

    // Step B: Clean the text and STRIP FOOTERS!
    // ADI automatically tags footers, headers, and page numbers with specific roles.
    const cleanParagraphs = paragraphList
      .filter((p) => !["pageHeader", "pageFooter", "pageNumber"].includes(String(p?.role || "")))
      .map((p) => String(p?.content || ""))
      .join("\n\n");

    // Step C: Convert visual grids/tables (like the Feedback Guide) into Markdown
    // This allows the LLM to easily read the row/column relationships
    let markdownTables = "";
    if (tableList.length > 0) {
      markdownTables = tableList.map((table, index) => {
        let tableStr = `\n### Table ${index + 1}\n`;
        let currentRowIndex = 0;

        const cells = Array.isArray(table?.cells) ? table.cells : [];
        cells.forEach((cell) => {
          if (cell.rowIndex !== currentRowIndex) {
            tableStr += "\n"; // New row
            currentRowIndex = cell.rowIndex;
          }
          // Clean out newlines within cells to keep markdown formatting intact
          const cellContent = String(cell?.content || "")
            .replace(/\n/g, " ")
            .trim();
          tableStr += `| ${cellContent} `;
        });
        return tableStr + "|\n";
      }).join("\n");
    }

    // Step D: Combine clean text and tables
    const masterDocumentText = cleanParagraphs + "\n\n" + markdownTables;

    // =====================================================================
    // 3. The Azure OpenAI Extraction Pass
    // =====================================================================
    console.log(`[parsePdf] Sending cleaned text to Azure OpenAI for structured extraction...`);
    
    // NOTE: Call your existing Azure OpenAI logic here, but pass `masterDocumentText` 
    // instead of sending images. 
    
    /* const structuredData = await callAzureOpenAI(masterDocumentText);
    */

    // For demonstration, simulating the return structure
    const parseStatus = pageList.length > 0 ? "complete" : "incomplete";
    const incompleteReason =
      parseStatus === "complete" ? null : "No pages extracted from Document Intelligence analysis.";

    return {
      reportId,
      parseStatus,
      reviewStatus: "ready",
      parsePages: pageList.length,
      parseMinExpectedPages: 42,
      _parseStatus: parseStatus,
      _parseDiagnostics: incompleteReason
        ? {
            incompleteReason,
          }
        : {},
      // data: structuredData
    };
  } catch (error) {
    console.error("[parsePdf] Fatal error during extraction:", error);
    const errorMessage = String(error?.message || "Unknown parse error");
    return {
      reportId,
      parseStatus: "incomplete",
      reviewStatus: "needs_review",
      error: errorMessage,
      _parseStatus: "incomplete",
      _parseDiagnostics: {
        incompleteReason: errorMessage,
      },
    };
  }
}
