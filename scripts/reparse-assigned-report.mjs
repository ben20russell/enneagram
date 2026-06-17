import { getSupabaseAdmin, getSupabaseStorageBucket } from "../lib/supabaseAdmin.js";
import { parsePdf } from "../lib/parsePdf.js";
import { buildMlExtractionLearningContext } from "../lib/mlExtractionLearning.js";
import { applyMlScoreLearningToParsedProfile } from "../lib/mlScoreLearning.js";
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
const preferLocalTextFirst = String(process.env.REPARSE_LOCAL_TEXT_FIRST || "0").trim() === "1";
const failOnParserFailure = String(process.env.REPARSE_FAIL_ON_PARSE_FAILURE || "1").trim() !== "0";
const enableIdentitySafeguard = String(process.env.REPARSE_IDENTITY_SAFEGUARD || "1").trim() !== "0";

function normalizeTypeNumber(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const floored = Math.floor(numeric);
    if (floored >= 1 && floored <= 9) return floored;
  }
  const match = String(value).match(/[1-9]/);
  return match?.[0] ? Number(match[0]) : null;
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeInstinctualVariant(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "sx" || normalized.includes("sexual") || normalized.includes("one-on-one") || normalized.includes("one on one")) {
    return "sx";
  }
  if (normalized === "so" || normalized.includes("social")) return "so";
  if (normalized === "sp" || normalized.includes("self-preservation") || normalized.includes("self preservation")) {
    return "sp";
  }
  return null;
}

function normalizeIntegrationLevel(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "high") return "High";
  if (lowered === "moderate" || lowered === "medium") return "Moderate";
  if (lowered === "low") return "Low";
  return normalized;
}

function buildIdentitySafeguardFromReport(report) {
  if (!enableIdentitySafeguard) return { enabled: false };
  const results = report?.results_data && typeof report.results_data === "object" ? report.results_data : {};
  const parsedProfile = results?.parsedProfile && typeof results.parsedProfile === "object" ? results.parsedProfile : {};
  const reviewCoreIdentity = results?.review?.coreIdentity && typeof results.review.coreIdentity === "object"
    ? results.review.coreIdentity
    : {};
  const verificationResolved = results?.ingestion?.parseDiagnostics?.verification?.resolvedFields
    && typeof results.ingestion.parseDiagnostics.verification.resolvedFields === "object"
    ? results.ingestion.parseDiagnostics.verification.resolvedFields
    : {};
  const mlGroundTruthIdentity = results?.ml?.feedback?.groundTruthIdentity
    && typeof results.ml.feedback.groundTruthIdentity === "object"
    ? results.ml.feedback.groundTruthIdentity
    : {};

  return {
    enabled: true,
    lockOnMismatch: true,
    source: "reparse-assigned-report",
    priorVerified: {
      primaryType: normalizeTypeNumber(
        mlGroundTruthIdentity?.primaryType
        ?? reviewCoreIdentity?.primaryType
        ?? verificationResolved?.primaryType
        ?? parsedProfile?.primaryType
        ?? report?.enneagram_type
        ?? null,
      ),
      typeName: normalizeOptionalString(
        reviewCoreIdentity?.typeName
        ?? verificationResolved?.typeName
        ?? parsedProfile?.typeName
        ?? parsedProfile?.core_type_name
        ?? null,
      ),
      instinctualVariant: normalizeInstinctualVariant(
        mlGroundTruthIdentity?.instinctualVariant
        ?? reviewCoreIdentity?.instinctualVariant
        ?? verificationResolved?.instinctualVariant
        ?? parsedProfile?.instinctualVariant
        ?? null,
      ),
      integrationLevel: normalizeIntegrationLevel(
        reviewCoreIdentity?.integrationLevel
        ?? verificationResolved?.integrationLevel
        ?? parsedProfile?.integrationLevel
        ?? null,
      ),
    },
  };
}

function getNonNullCount(obj) {
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).filter((v) => v != null).length;
}

function computeCompletenessFromParsed(parsed, diagnostics) {
  const pages = Number(diagnostics?.extraction?.pages ?? parsed?.reportContent?.pages?.length ?? 0);
  const detectedTotalPages = Number(diagnostics?.extraction?.detectedTotalPages ?? null);
  const minPages = Number(diagnostics?.extraction?.minExpectedPages ?? process.env.PDF_PARSE_MIN_PAGES ?? 20);
  const typeNonNull = getNonNullCount(parsed?.typeScores);
  const instinctNonNull = getNonNullCount(parsed?.instinctScores);
  const centerNonNull = getNonNullCount(parsed?.centerScores);
  const hasAllChartScores = typeNonNull === 9 && instinctNonNull === 3 && centerNonNull === 3;
  const coverageTarget = detectedTotalPages || minPages || null;
  const hasCoverageComplete = coverageTarget != null ? pages >= coverageTarget : pages > 0;
  const hasCoreIdentity = Boolean(parsed?.primaryType || parsed?.typeName);
  const verificationCriticalMismatchCount = Number(diagnostics?.verification?.criticalMismatchCount ?? 0);
  const verificationCriticalMismatchKeys = Array.isArray(diagnostics?.verification?.criticalMismatchKeys)
    ? diagnostics.verification.criticalMismatchKeys.filter(Boolean)
    : [];
  const hasVerificationConsistency = verificationCriticalMismatchCount <= 0;
  const isComplete = hasCoverageComplete && hasCoreIdentity && hasVerificationConsistency;
  let incompleteReason = null;
  const warnings = [];
  if (!hasCoverageComplete) {
    incompleteReason = detectedTotalPages > 0
      ? `Extracted ${pages} pages, detected ${detectedTotalPages}`
      : `Extracted ${pages} pages, expected at least ${minPages}`;
  } else if (!hasCoreIdentity) {
    incompleteReason = "Core identity incomplete: missing primary type and type name";
  } else if (!hasVerificationConsistency) {
    const mismatchLabel = verificationCriticalMismatchKeys.length
      ? verificationCriticalMismatchKeys.join(", ")
      : "identity fields";
    incompleteReason = `Python cross-check mismatch detected in ${mismatchLabel}`;
  }
  if (detectedTotalPages > 0 && minPages > 0 && detectedTotalPages < minPages) {
    warnings.push(
      `Detected total pages (${detectedTotalPages}) are below configured min expected pages (${minPages}); completeness uses detected coverage.`,
    );
  }
  if (!hasAllChartScores) {
    warnings.push("Chart numerics are partial; keeping parse result usable with warning.");
  }
  return {
    isComplete,
    incompleteReason,
    hasCoreIdentity,
    pages,
    detectedTotalPages,
    coverageTarget,
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
  const extractionLearningContext = await buildMlExtractionLearningContext({
    supabase,
    table,
    reportId: report.id,
  });
  console.log("[reparse-assigned-report] Extraction learning context prepared", {
    reportId: report.id,
    status: extractionLearningContext?.status || "unknown",
    reason: extractionLearningContext?.reason || null,
    trainingSamples: extractionLearningContext?.training?.trainingSampleCount ?? 0,
    hints: extractionLearningContext?.hintCount ?? 0,
  });
  const identitySafeguard = buildIdentitySafeguardFromReport(report);
  console.log("[reparse-assigned-report] Identity safeguard configuration", {
    reportId: report.id,
    enabled: Boolean(identitySafeguard?.enabled),
    source: identitySafeguard?.source || null,
    lockOnMismatch: Boolean(identitySafeguard?.lockOnMismatch),
    priorPrimaryType: identitySafeguard?.priorVerified?.primaryType ?? null,
    priorInstinctualVariant: identitySafeguard?.priorVerified?.instinctualVariant ?? null,
    priorTypeName: identitySafeguard?.priorVerified?.typeName ?? null,
  });
  let rawTextOverride = null;
  let pageCountOverride = null;
  let localExtractedPages = [];
  let localExtractionDiagnostics = null;
  if (!preferLocalTextFirst) {
    console.log(
      "[reparse-assigned-report] local raw-text-first extraction disabled by default. Using layout-html -> agentic OCR parser path first.",
    );
  }
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
      console.log("[reparse-assigned-report] local OCR-aware extraction failed; continuing with markdown-first parse.", {
        details,
      });
    }
  }
  const parsed = await parsePdf(pdfBuffer, {
    sourceFileName: fileName || "report.pdf",
    allowLocalTextFallback: true,
    enablePythonCrossCheck: true,
    extractionLearningContext,
    identitySafeguard,
    rawTextOverride,
    pageCountOverride,
    pagesOverride: localExtractedPages,
  });
  const mlLearningResult = await applyMlScoreLearningToParsedProfile({
    supabase,
    table,
    parsedProfile: parsed,
    reportId: report.id,
  });
  const parsedForSave =
    mlLearningResult?.parsedProfile && typeof mlLearningResult.parsedProfile === "object"
      ? mlLearningResult.parsedProfile
      : parsed;
  const mlLearning =
    mlLearningResult?.ml && typeof mlLearningResult.ml === "object"
      ? mlLearningResult.ml
      : null;
  console.log("[reparse-assigned-report] ML score learning completed", {
    reportId: report.id,
    mlStatus: mlLearning?.status || "unknown",
    mlReason: mlLearning?.reason || null,
    mlTrainingSamples: mlLearning?.training?.trainingSampleCount ?? null,
    mlAppliedScoreCount: mlLearning?.applied?.appliedCounts?.total ?? 0,
  });
  const parseDiagnostics =
    parsedForSave &&
    typeof parsedForSave === "object" &&
    parsedForSave._parseDiagnostics &&
    typeof parsedForSave._parseDiagnostics === "object"
      ? parsedForSave._parseDiagnostics
      : null;
  const parseState = String(parsedForSave?._parseState || parsedForSave?.parseState || "").trim().toLowerCase();
  const parseFailureReason = String(parsedForSave?._parseReason || parsedForSave?.parseReason || "Unknown parse failure").trim();
  if (failOnParserFailure && parseState === "failed") {
    throw new Error(`Parser returned failed state: ${parseFailureReason}`);
  }
  const parseReview =
    parsedForSave &&
    typeof parsedForSave === "object" &&
    parsedForSave._review &&
    typeof parsedForSave._review === "object"
      ? parsedForSave._review
      : null;
  const recomputed = computeCompletenessFromParsed(parsedForSave, parseDiagnostics);
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
    : (Array.isArray(parsedForSave?.reportContent?.pages) ? parsedForSave.reportContent.pages : []);

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
      detectedType: parsedForSave?.primaryType ? String(parsedForSave.primaryType) : null,
      detectedTypeSource: `azure-openai:${process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini"}`,
      sourceFileName: fileName,
      basicFear: parsedForSave?.coreFear || null,
      basicDesire: parsedForSave?.coreDesire || null,
      passion: report?.results_data?.dashboardContext?.passion || null,
      integrationLevel: parsedForSave?.integrationLevel || null,
      instinct: parsedForSave?.instinctualVariant || null,
      reportSummary: parsedForSave?.reportSummary || null,
    },
    extractedContent: {
      ...(report.results_data?.extractedContent || {}),
      documentSummary: parsedForSave?.reportContent?.documentSummary || null,
      pages: extractedContentPages,
      sections: Array.isArray(parsedForSave?.reportContent?.sections) ? parsedForSave.reportContent.sections : [],
      extractedAt: new Date().toISOString(),
      parserVersion: nextDiagnostics?.parserVersion || "multi-pass-v3",
    },
    parsedProfile: parsedForSave,
    ml: {
      ...(report.results_data?.ml && typeof report.results_data.ml === "object" ? report.results_data.ml : {}),
      ...(mlLearning || {}),
    },
  };

  const { error: updateErr } = await supabase
    .from(table)
    .update({
      results_data: nextResultsData,
      enneagram_type: parsedForSave?.primaryType ? String(parsedForSave.primaryType) : report.enneagram_type,
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
        parsedPrimaryType: parsedForSave?.primaryType || null,
        parsedInstinctualVariant: parsedForSave?.instinctualVariant || null,
        parserModel: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini",
        mlStatus: mlLearning?.status || null,
        mlTrainingSamples: mlLearning?.training?.trainingSampleCount ?? null,
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
