import { getSupabaseAdmin, getSupabaseStorageBucket } from "../lib/supabaseAdmin.js";
import { parsePdf } from "../lib/parsePdf.js";
import { readFileSync, existsSync, promises as fs } from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const LOCAL_EXTRACT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const LOCAL_EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) return;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || process.env[key]) return;
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const userEmail = (process.argv[2] || "ben20russell@gmail.com").trim().toLowerCase();
const table = process.env.SUPABASE_REPORTS_TABLE || "reports";
const supabase = getSupabaseAdmin();
const preferLocalTextFirst = String(process.env.REPARSE_LOCAL_TEXT_FIRST || "1").trim() !== "0";
const failOnParserFailure = String(process.env.REPARSE_FAIL_ON_PARSE_FAILURE || "1").trim() !== "0";

function getNonNullCount(obj) {
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).filter((v) => v != null).length;
}

function computeCompletenessFromParsed(parsed, diagnostics) {
  const pages = Number(diagnostics?.extraction?.pages ?? parsed?.reportContent?.pages?.length ?? 0);
  const minPages = Number(diagnostics?.extraction?.minExpectedPages ?? process.env.PDF_PARSE_MIN_PAGES ?? 20);
  const typeNonNull = getNonNullCount(parsed?.typeScores);
  const instinctNonNull = getNonNullCount(parsed?.instinctScores);
  const centerNonNull = getNonNullCount(parsed?.centerScores);
  const hasAllChartScores = typeNonNull === 9 && instinctNonNull === 3 && centerNonNull === 3;
  const hasMinPages = pages >= minPages;
  const hasCoreIdentity = Boolean(parsed?.primaryType || parsed?.typeName);
  const verificationCriticalMismatchCount = Number(diagnostics?.verification?.criticalMismatchCount ?? 0);
  const verificationCriticalMismatchKeys = Array.isArray(diagnostics?.verification?.criticalMismatchKeys)
    ? diagnostics.verification.criticalMismatchKeys.filter(Boolean)
    : [];
  const hasVerificationConsistency = verificationCriticalMismatchCount <= 0;
  const isComplete = hasMinPages && hasCoreIdentity && hasVerificationConsistency;
  let incompleteReason = null;
  const warnings = [];
  if (!hasMinPages) {
    incompleteReason = `Extracted ${pages} pages, expected at least ${minPages}`;
  } else if (!hasCoreIdentity) {
    incompleteReason = "Core identity incomplete: missing primary type and type name";
  } else if (!hasVerificationConsistency) {
    const mismatchLabel = verificationCriticalMismatchKeys.length
      ? verificationCriticalMismatchKeys.join(", ")
      : "identity fields";
    incompleteReason = `Python cross-check mismatch detected in ${mismatchLabel}`;
  }
  if (!hasAllChartScores) {
    warnings.push("Chart numerics are partial; keeping parse result usable with warning.");
  }
  return {
    isComplete,
    incompleteReason,
    hasCoreIdentity,
    pages,
    minPages,
    typeNonNull,
    instinctNonNull,
    centerNonNull,
    warnings,
  };
}

function normalizeExtractedPages(rawPages) {
  return (Array.isArray(rawPages) ? rawPages : [])
    .map((page, index) => ({
      pageNumber: Number.isFinite(Number(page?.pageNumber))
        ? Math.max(1, Math.floor(Number(page.pageNumber)))
        : index + 1,
      extractedText: String(page?.extractedText || "").trim(),
    }))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

function buildRawTextWithPageMarkers(pages) {
  return pages
    .map((page, index) => {
      const pageNumber = Number.isFinite(Number(page?.pageNumber))
        ? Math.max(1, Math.floor(Number(page.pageNumber)))
        : index + 1;
      const text = String(page?.extractedText || "").trim();
      if (!text) return "";
      return `[Page ${pageNumber}]\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function extractRawTextOverrideFromPdf(pdfBuffer) {
  const tempDir = await fs.mkdtemp(resolve(os.tmpdir(), "reparse-local-text-"));
  const inputPdfPath = resolve(tempDir, "report.pdf");
  try {
    await fs.writeFile(inputPdfPath, pdfBuffer);
    const parserScriptPath = fileURLToPath(new URL("../lib/extract_pdf_pages.py", import.meta.url));
    const { stdout } = await execFileAsync("python3", [parserScriptPath, inputPdfPath], {
      maxBuffer: LOCAL_EXTRACT_MAX_BUFFER_BYTES,
      timeout: LOCAL_EXTRACT_TIMEOUT_MS,
    });
    let payload = {};
    try {
      payload = JSON.parse(String(stdout || "{}"));
    } catch (parseError) {
      throw new Error(`Failed to parse extract_pdf_pages.py JSON output: ${String(parseError?.message || parseError)}`);
    }
    const payloadError = String(payload?.error || "").trim();
    if (payloadError) {
      throw new Error(`extract_pdf_pages.py reported an error: ${payloadError}`);
    }

    const pages = normalizeExtractedPages(payload?.pages);
    const rawTextOverride = buildRawTextWithPageMarkers(pages);
    if (!rawTextOverride) {
      throw new Error("extract_pdf_pages.py returned no usable text for rawTextOverride.");
    }

    return {
      pages,
      rawTextOverride,
      pageCountOverride: pages.length > 0 ? pages.length : null,
      diagnostics: payload?.diagnostics && typeof payload.diagnostics === "object" ? payload.diagnostics : null,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const { data: report, error: reportErr } = await supabase
    .from(table)
    .select("*")
    .ilike("user_email", userEmail)
    .eq("source", "admin-import")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reportErr) throw new Error(`Failed to fetch assigned report row: ${reportErr.message}`);
  if (!report) throw new Error(`No admin-import report found for ${userEmail}`);

  const bucket = report?.report_pdf?.bucket || getSupabaseStorageBucket();
  const storagePath = report?.report_pdf?.storagePath;
  const fileName = report?.report_pdf?.fileName || null;

  if (!storagePath) {
    throw new Error("Assigned report row has no report_pdf.storagePath");
  }

  const { data: fileBlob, error: downloadErr } = await supabase.storage
    .from(bucket)
    .download(storagePath);

  if (downloadErr || !fileBlob) {
    throw new Error(`Failed to download assigned PDF: ${downloadErr?.message || "unknown error"}`);
  }

  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());
  let rawTextOverride = null;
  let pageCountOverride = null;
  let localExtractedPages = [];
  let localExtractionDiagnostics = null;
  if (preferLocalTextFirst) {
    try {
      const localExtraction = await extractRawTextOverrideFromPdf(pdfBuffer);
      rawTextOverride = localExtraction.rawTextOverride;
      pageCountOverride = localExtraction.pageCountOverride;
      localExtractedPages = localExtraction.pages;
      localExtractionDiagnostics = localExtraction.diagnostics;
      console.log("[reparse-assigned-report] local OCR-aware text extraction succeeded; using rawTextOverride.", {
        chars: rawTextOverride.length,
        pages: localExtractedPages.length,
        fallbackTriggered: Boolean(localExtractionDiagnostics?.fallbackTriggered),
        ocrAppliedPageCount: Array.isArray(localExtractionDiagnostics?.ocrAppliedPageNumbers)
          ? localExtractionDiagnostics.ocrAppliedPageNumbers.length
          : 0,
      });
    } catch (localExtractionError) {
      const details = String(localExtractionError?.message || localExtractionError);
      if (/No module named ['"]pypdf['"]/.test(details)) {
        console.log(
          "[reparse-assigned-report] local OCR-aware extraction is missing pypdf in current python interpreter. Install with: python3 -m pip install pypdf pdfplumber pdf2image pytesseract pillow",
        );
      }
      console.log("[reparse-assigned-report] local OCR-aware extraction failed; continuing with attached parse.", {
        details,
      });
    }
  }
  const parsed = await parsePdf(pdfBuffer, {
    allowLocalTextFallback: true,
    enablePythonCrossCheck: true,
    rawTextOverride,
    pageCountOverride,
    pagesOverride: localExtractedPages,
  });
  const parseDiagnostics =
    parsed && typeof parsed === "object" && parsed._parseDiagnostics && typeof parsed._parseDiagnostics === "object"
      ? parsed._parseDiagnostics
      : null;
  const parseState = String(parsed?._parseState || parsed?.parseState || "").trim().toLowerCase();
  const parseFailureReason = String(parsed?._parseReason || parsed?.parseReason || "Unknown parse failure").trim();
  if (failOnParserFailure && parseState === "failed") {
    throw new Error(`Parser returned failed state: ${parseFailureReason}`);
  }
  const parseReview =
    parsed && typeof parsed === "object" && parsed._review && typeof parsed._review === "object"
      ? parsed._review
      : null;
  const recomputed = computeCompletenessFromParsed(parsed, parseDiagnostics);
  const localTextFirstDiagnostics = rawTextOverride
    ? {
      enabled: true,
      chars: rawTextOverride.length,
      pageCount: pageCountOverride,
      primaryEngine: localExtractionDiagnostics?.primaryEngine || null,
      fallbackTriggered: Boolean(localExtractionDiagnostics?.fallbackTriggered),
      noisyPageCount: Array.isArray(localExtractionDiagnostics?.noisyPageNumbers)
        ? localExtractionDiagnostics.noisyPageNumbers.length
        : 0,
      ocrAppliedPageCount: Array.isArray(localExtractionDiagnostics?.ocrAppliedPageNumbers)
        ? localExtractionDiagnostics.ocrAppliedPageNumbers.length
        : 0,
      ocrFailedPageCount: Array.isArray(localExtractionDiagnostics?.ocrFailedPageNumbers)
        ? localExtractionDiagnostics.ocrFailedPageNumbers.length
        : 0,
    }
    : {
      enabled: false,
    };
  const nextDiagnostics = {
    ...(parseDiagnostics || {}),
    isComplete: recomputed.isComplete,
    incompleteReason: recomputed.incompleteReason,
    extraction: {
      ...(parseDiagnostics?.extraction || {}),
      pages: recomputed.pages,
      minExpectedPages: recomputed.minPages,
      localTextFirst: localTextFirstDiagnostics,
    },
    scoreCoverage: {
      ...(parseDiagnostics?.scoreCoverage || {}),
      typeScoresNonNull: recomputed.typeNonNull,
      typeScoresTotal: 9,
      instinctScoresNonNull: recomputed.instinctNonNull,
      instinctScoresTotal: 3,
      centerScoresNonNull: recomputed.centerNonNull,
      centerScoresTotal: 3,
    },
    warnings: Array.from(
      new Set([
        ...((Array.isArray(parseDiagnostics?.warnings) ? parseDiagnostics.warnings : [])
          .map((entry) => (typeof entry === "string" ? entry : entry?.message))
          .filter(Boolean)),
        ...(Array.isArray(recomputed?.warnings) ? recomputed.warnings : []),
      ]),
    ),
    completedAt: new Date().toISOString(),
  };
  const parseStatus = recomputed.isComplete ? "complete" : "incomplete";
  const reviewStatus = parseReview?.status || (recomputed.isComplete ? "auto_approved" : "needs_review");
  const extractedContentPages = localExtractedPages.length > 0
    ? localExtractedPages
    : (Array.isArray(parsed?.reportContent?.pages) ? parsed.reportContent.pages : []);

  const nextResultsData = {
    ...(report.results_data && typeof report.results_data === "object" ? report.results_data : {}),
    ingestion: {
      ...(report.results_data?.ingestion || {}),
      status: parseStatus === "complete" && reviewStatus !== "needs_review" ? "ready" : "incomplete",
      mode: "admin-import-auto",
      ingestedAt: new Date().toISOString(),
      reportId: report.id,
      parser: {
        provider: "azure-openai",
        model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini",
      },
      parseDiagnostics: nextDiagnostics,
    },
    review: {
      ...(report.results_data?.review || {}),
      ...(parseReview || {}),
      status: reviewStatus,
      updatedAt: new Date().toISOString(),
    },
    dashboardContext: {
      ...(report.results_data?.dashboardContext || {}),
      detectedType: parsed?.primaryType ? String(parsed.primaryType) : null,
      detectedTypeSource: `azure-openai:${process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini"}`,
      sourceFileName: fileName,
      basicFear: parsed?.coreFear || null,
      basicDesire: parsed?.coreDesire || null,
      passion: report?.results_data?.dashboardContext?.passion || null,
      integrationLevel: parsed?.integrationLevel || null,
      instinct: parsed?.instinctualVariant || null,
      reportSummary: parsed?.reportSummary || null,
    },
    extractedContent: {
      ...(report.results_data?.extractedContent || {}),
      documentSummary: parsed?.reportContent?.documentSummary || null,
      pages: extractedContentPages,
      sections: Array.isArray(parsed?.reportContent?.sections) ? parsed.reportContent.sections : [],
      extractedAt: new Date().toISOString(),
      parserVersion: nextDiagnostics?.parserVersion || "multi-pass-v3",
    },
    parsedProfile: parsed,
  };

  const { error: updateErr } = await supabase
    .from(table)
    .update({
      results_data: nextResultsData,
      enneagram_type: parsed?.primaryType ? String(parsed.primaryType) : report.enneagram_type,
    })
    .eq("id", report.id);

  if (updateErr) throw new Error(`Failed to update parsed results_data: ${updateErr.message}`);

  console.log(
    JSON.stringify(
      {
        success: true,
        reportId: report.id,
        userEmail,
        bucket,
        storagePath,
        sourceFileName: fileName,
        parsedPrimaryType: parsed?.primaryType || null,
        parsedInstinctualVariant: parsed?.instinctualVariant || null,
        parserModel: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini",
        parseStatus,
        parsePages: nextDiagnostics?.extraction?.pages ?? null,
        parseMinExpectedPages: nextDiagnostics?.extraction?.minExpectedPages ?? null,
        reviewStatus,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[reparse-assigned-report] failed", String(error?.message || error));
  process.exit(1);
});
