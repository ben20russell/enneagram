import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../../lib/adminAccess";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../../../lib/supabaseAdmin";
import { applyMlScoreLearningToParsedProfile } from "../../../../lib/mlScoreLearning";
import { resolveMinExpectedPagesByReportType } from "../../../../lib/reportTypePageThresholds";
import { extractClientNameFromReportFileName } from "../../../../lib/reportFileNameClientName";

export const runtime = "nodejs";
export const maxDuration = 300;

function getNonNullCount(obj) {
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).filter((v) => v != null).length;
}

function toPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

const configuredDefaultMinExpectedPages = toPositiveInteger(process.env.PDF_PARSE_MIN_PAGES ?? null) || 20;

function resolveReportMinExpectedPages(fileName, fallbackMinExpectedPages) {
  return resolveMinExpectedPagesByReportType({
    fileName,
    fallbackMinExpectedPages,
    defaultMinExpectedPages: configuredDefaultMinExpectedPages,
  });
}

function buildParseContract({ diagnostics, parseStatus, parseReason }) {
  const parsedPages = toPositiveInteger(diagnostics?.extraction?.pages ?? null);
  const detectedTotalPages = toPositiveInteger(diagnostics?.extraction?.detectedTotalPages ?? null);
  const minExpectedPages = toPositiveInteger(diagnostics?.extraction?.minExpectedPages ?? null);
  const coverageTarget = detectedTotalPages || minExpectedPages || null;
  const parseCoverage = {
    parsedPages,
    detectedTotalPages,
    minExpectedPages,
    isCoverageComplete: coverageTarget != null
      ? (parsedPages != null && parsedPages >= coverageTarget)
      : Boolean(parsedPages != null && parsedPages > 0),
  };

  const verificationSummary = {
    available: Boolean(diagnostics?.verification?.available),
    mismatchCount: Number(diagnostics?.verification?.mismatchCount ?? 0),
    criticalMismatchCount: Number(diagnostics?.verification?.criticalMismatchCount ?? 0),
    criticalMismatchKeys: Array.isArray(diagnostics?.verification?.criticalMismatchKeys)
      ? diagnostics.verification.criticalMismatchKeys.filter(Boolean)
      : [],
  };

  return {
    parseCoverage,
    verificationSummary,
    parseState: parseStatus === "complete" ? "complete" : "incomplete",
    parseReason: parseReason || null,
  };
}

function inferTypeFromFileName(fileName) {
  const normalized = String(fileName || "");
  const withoutProductToken = normalized.replace(/\biEQ\s*9\b/gi, " ");
  const typeMatch = withoutProductToken.match(/\b(?:enneagram[\s_-]*)?type[\s_-]*([1-9])\b/i);
  if (typeMatch?.[1]) return typeMatch[1];
  const enneaMatch = withoutProductToken.match(/\bennea[\s_-]*([1-9])\b/i);
  if (enneaMatch?.[1]) return enneaMatch[1];
  return null;
}

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

function normalizeInstinctualVariant(value) {
  const normalized = String(value || "").trim().toLowerCase();
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
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "high") return "High";
  if (lowered === "moderate" || lowered === "medium") return "Moderate";
  if (lowered === "low") return "Low";
  return normalized;
}

function resolveHydrationIdentityFields({ parsed, diagnostics, fileName }) {
  const verification = diagnostics?.verification && typeof diagnostics.verification === "object"
    ? diagnostics.verification
    : {};
  const verificationResolvedFields = verification?.resolvedFields && typeof verification.resolvedFields === "object"
    ? verification.resolvedFields
    : {};
  const pythonIdentity = verification?.python && typeof verification.python === "object"
    ? verification.python
    : {};
  const inferredType = normalizeTypeNumber(inferTypeFromFileName(fileName));
  const primaryTypeValue =
    normalizeTypeNumber(verificationResolvedFields?.primaryType) ??
    normalizeTypeNumber(pythonIdentity?.detectedType) ??
    normalizeTypeNumber(parsed?.primaryType) ??
    inferredType;
  const instinctualVariant =
    normalizeInstinctualVariant(verificationResolvedFields?.instinctualVariant) ??
    normalizeInstinctualVariant(pythonIdentity?.instinctCode || pythonIdentity?.instinctLabel) ??
    normalizeInstinctualVariant(parsed?.instinctualVariant) ??
    null;
  const integrationLevel =
    normalizeIntegrationLevel(verificationResolvedFields?.integrationLevel) ??
    normalizeIntegrationLevel(pythonIdentity?.integrationLevel) ??
    normalizeIntegrationLevel(parsed?.integrationLevel) ??
    null;
  const verificationType = normalizeTypeNumber(verificationResolvedFields?.primaryType);
  const detectedTypeSource =
    verificationType != null
      ? `python-cross-check:${verification?.source || "extract_report_pdf"}`
      : `azure-openai:${process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini"}`;

  return {
    primaryType: primaryTypeValue != null ? String(primaryTypeValue) : null,
    instinctualVariant,
    integrationLevel,
    detectedTypeSource,
  };
}

function computeCompletenessFromParsed(parsed, diagnostics, fileName) {
  const pages = Number(diagnostics?.extraction?.pages ?? parsed?.reportContent?.pages?.length ?? 0);
  const minPages = resolveReportMinExpectedPages(fileName, diagnostics?.extraction?.minExpectedPages ?? null);
  const typeNonNull = getNonNullCount(parsed?.typeScores);
  const instinctNonNull = getNonNullCount(parsed?.instinctScores);
  const centerNonNull = getNonNullCount(parsed?.centerScores);
  const hasAllChartScores = typeNonNull === 9 && instinctNonNull === 3 && centerNonNull === 3;
  const hasMinPages = pages >= minPages;
  const hasCoreIdentity = Boolean(parsed?.primaryType || parsed?.typeName);
  const criticalHydrated = Number(diagnostics?.sectionCoverage?.criticalHydrated ?? 0);
  const criticalTotal = Number(diagnostics?.sectionCoverage?.criticalTotal ?? 0);
  const hasCriticalSections = criticalTotal > 0 ? criticalHydrated >= criticalTotal : true;
  const verificationMismatchCount = Number(diagnostics?.verification?.mismatchCount ?? 0);
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
  if (!hasCriticalSections) {
    warnings.push(`Critical section hydration incomplete (${criticalHydrated}/${criticalTotal}).`);
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
    criticalHydrated,
    criticalTotal,
    verificationMismatchCount,
    verificationCriticalMismatchCount,
    verificationCriticalMismatchKeys,
    warnings,
  };
}

export async function POST(req) {
  console.log("[admin-import:reparse] Incoming POST request");
  const reportsTable = process.env.SUPABASE_REPORTS_TABLE || "reports";
  let requesterEmail = "";
  let reportId = "";
  let supabase = null;
  let report = null;

  try {
    const session = await getServerSession(authOptions);
    requesterEmail = normalizeEmail(session?.user?.email);
    if (!session || !requesterEmail || !hasAdminAccess(requesterEmail)) {
      console.log("[admin-import:reparse] Unauthorized requester", { requesterEmail });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
      body = await req.json();
    } catch (error) {
      console.log("[admin-import:reparse] Failed to parse JSON body", error);
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    reportId = String(body?.reportId || "").trim();
    if (!reportId) {
      return NextResponse.json({ error: "Missing reportId" }, { status: 400 });
    }

    supabase = getSupabaseAdmin();

    const { data: loadedReport, error: reportErr } = await supabase
      .from(reportsTable)
      .select("id,user_email,enneagram_type,results_data,report_pdf")
      .eq("id", reportId)
      .maybeSingle();

    if (reportErr) {
      throw new Error(`Failed to fetch report: ${reportErr.message}`);
    }
    if (!loadedReport) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    report = loadedReport;

    const bucket = report?.report_pdf?.bucket || getSupabaseStorageBucket();
    const storagePath = report?.report_pdf?.storagePath;
    const fileName = report?.report_pdf?.fileName || null;
    if (!storagePath) {
      return NextResponse.json({ error: "Report has no stored PDF path" }, { status: 400 });
    }

    const { data: fileBlob, error: downloadErr } = await supabase.storage.from(bucket).download(storagePath);
    if (downloadErr || !fileBlob) {
      throw new Error(`Failed to download report PDF: ${downloadErr?.message || "unknown error"}`);
    }

    const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());
    const { parsePdf } = await import("../../../../lib/parsePdf.js");
    const parsed = await parsePdf(pdfBuffer, {
      disableImagePipeline: true,
      disableImageScoreRescue: true,
      allowLocalTextFallback: true,
      enablePythonCrossCheck: true,
    });
    const mlLearningResult = await applyMlScoreLearningToParsedProfile({
      supabase,
      table: reportsTable,
      parsedProfile: parsed,
      reportId: report.id,
    });
    const parsedForSave =
      mlLearningResult?.parsedProfile && typeof mlLearningResult.parsedProfile === "object"
        ? mlLearningResult.parsedProfile
        : parsed;
    const mlLearning = mlLearningResult?.ml && typeof mlLearningResult.ml === "object"
      ? mlLearningResult.ml
      : null;
    console.log("[admin-import:reparse] ML score learning completed", {
      reportId: report.id,
      mlStatus: mlLearning?.status || "unknown",
      mlReason: mlLearning?.reason || null,
      mlTrainingSamples: mlLearning?.training?.trainingSampleCount ?? null,
      mlAppliedScoreCount: mlLearning?.applied?.appliedCounts?.total ?? 0,
    });

    const parseDiagnostics =
      parsedForSave && typeof parsedForSave === "object" && parsedForSave._parseDiagnostics && typeof parsedForSave._parseDiagnostics === "object"
        ? parsedForSave._parseDiagnostics
        : null;
    const parseReview =
      parsedForSave && typeof parsedForSave === "object" && parsedForSave._review && typeof parsedForSave._review === "object"
        ? parsedForSave._review
        : null;

    const recomputed = computeCompletenessFromParsed(parsedForSave, parseDiagnostics, fileName);
    const nextDiagnostics = {
      ...(parseDiagnostics || {}),
      isComplete: recomputed.isComplete,
      incompleteReason: recomputed.incompleteReason,
      extraction: {
        ...(parseDiagnostics?.extraction || {}),
        pages: recomputed.pages,
        minExpectedPages: recomputed.minPages,
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
      sectionCoverage: {
        ...(parseDiagnostics?.sectionCoverage || {}),
        criticalHydrated: recomputed.criticalHydrated,
        criticalTotal: recomputed.criticalTotal,
      },
      completedAt: new Date().toISOString(),
      warnings: Array.from(
        new Set([
          ...((Array.isArray(parseDiagnostics?.warnings) ? parseDiagnostics.warnings : []).map((entry) =>
            typeof entry === "string" ? entry : entry?.message
          ).filter(Boolean)),
          ...recomputed.warnings,
        ]),
      ),
    };

    const parseStatus = recomputed.isComplete ? "complete" : "incomplete";
    const reviewStatus = parseReview?.status || (recomputed.isComplete ? "auto_approved" : "needs_review");

    const priorResults = report?.results_data && typeof report.results_data === "object" ? report.results_data : {};
    const priorDashboardContext =
      priorResults?.dashboardContext && typeof priorResults.dashboardContext === "object"
        ? priorResults.dashboardContext
        : {};
    const resolvedIdentity = resolveHydrationIdentityFields({
      parsed: parsedForSave,
      diagnostics: nextDiagnostics,
      fileName,
    });
    const fileNameClientName = extractClientNameFromReportFileName(fileName);
    const parsedClientName = String(parsedForSave?.clientName || "").trim() || null;
    const resolvedClientName = parsedClientName || fileNameClientName || null;
    const parsedProfileWithClientName =
      parsedForSave && typeof parsedForSave === "object"
        ? {
          ...parsedForSave,
          clientName: resolvedClientName,
        }
        : parsedForSave;

    const nextResultsData = {
      ...priorResults,
      ingestion: {
        ...(priorResults?.ingestion || {}),
        status: parseStatus === "complete" && reviewStatus !== "needs_review" ? "ready" : "incomplete",
        mode: "admin-import-auto",
        ingestedAt: new Date().toISOString(),
        reportId: report.id,
        parser: {
          provider: "azure-openai",
          model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini",
        },
        ml: mlLearning && typeof mlLearning === "object"
          ? mlLearning
          : {
            status: "skipped",
            reason: "ml_learning_not_run",
          },
        parseAttempt: {
          at: new Date().toISOString(),
          triggeredBy: requesterEmail,
          ok: true,
        },
        parseDiagnostics: nextDiagnostics,
      },
      review: {
        ...(priorResults?.review || {}),
        ...(parseReview || {}),
        status: reviewStatus,
        updatedAt: new Date().toISOString(),
      },
      dashboardContext: {
        ...priorDashboardContext,
        detectedType: resolvedIdentity.primaryType,
        detectedTypeSource: resolvedIdentity.detectedTypeSource,
        sourceFileName: fileName,
        clientName: resolvedClientName,
        basicFear: parsedForSave?.coreFear || null,
        basicDesire: parsedForSave?.coreDesire || null,
        passion: priorDashboardContext?.passion || null,
        integrationLevel: resolvedIdentity.integrationLevel,
        instinct: resolvedIdentity.instinctualVariant,
        reportSummary: parsedForSave?.reportSummary || null,
      },
      extractedContent: {
        ...(priorResults?.extractedContent || {}),
        documentSummary: parsedForSave?.reportContent?.documentSummary || null,
        pages: Array.isArray(parsedForSave?.reportContent?.pages) ? parsedForSave.reportContent.pages : [],
        sections: Array.isArray(parsedForSave?.reportContent?.sections) ? parsedForSave.reportContent.sections : [],
        extractedAt: new Date().toISOString(),
        parserVersion: nextDiagnostics?.parserVersion || "multi-pass-v3",
      },
      parsedProfile: parsedProfileWithClientName,
    };

    const { error: updateErr } = await supabase
      .from(reportsTable)
      .update({
        results_data: nextResultsData,
        enneagram_type: resolvedIdentity.primaryType || report.enneagram_type,
      })
      .eq("id", report.id);

    if (updateErr) {
      throw new Error(`Failed to update report parse results: ${updateErr.message}`);
    }

    console.log("[admin-import:reparse] Parse completed and saved", {
      reportId: report.id,
      parseStatus,
      reviewStatus,
      parsePages: nextDiagnostics?.extraction?.pages ?? null,
      parseMinExpectedPages: nextDiagnostics?.extraction?.minExpectedPages ?? null,
      parseDetectedTotalPages: nextDiagnostics?.extraction?.detectedTotalPages ?? null,
    });
    const parseReason = nextDiagnostics?.incompleteReason ?? null;
    const {
      parseCoverage,
      verificationSummary,
      parseState,
      parseReason: normalizedParseReason,
    } = buildParseContract({
      diagnostics: nextDiagnostics,
      parseStatus,
      parseReason,
    });

    return NextResponse.json(
      {
        success: true,
        reportId: report.id,
        parseStatus,
        reviewStatus,
        parseIncompleteReason: nextDiagnostics?.incompleteReason ?? null,
        parsePages: nextDiagnostics?.extraction?.pages ?? null,
        parseMinExpectedPages: nextDiagnostics?.extraction?.minExpectedPages ?? null,
        parseDetectedTotalPages: nextDiagnostics?.extraction?.detectedTotalPages ?? null,
        parseCoverage,
        verificationSummary,
        parseState,
        parseReason: normalizedParseReason,
      },
      { status: 200 },
    );
  } catch (error) {
    const details = String(error?.message || "Unknown reparse error");
    console.log("[admin-import:reparse] Failed to reparse report", {
      reportId,
      details,
      stack: error?.stack,
    });

    if (report?.id && supabase) {
      try {
        const priorResults = report?.results_data && typeof report.results_data === "object"
          ? report.results_data
          : {};
        const priorIngestion = priorResults?.ingestion && typeof priorResults.ingestion === "object"
          ? priorResults.ingestion
          : {};
        const priorDiagnostics =
          priorIngestion?.parseDiagnostics && typeof priorIngestion.parseDiagnostics === "object"
            ? priorIngestion.parseDiagnostics
            : {};

        const nextResultsDataOnFailure = {
          ...priorResults,
          ingestion: {
            ...priorIngestion,
            status: "incomplete",
            mode: "admin-import-auto",
            ingestedAt: new Date().toISOString(),
            reportId: report.id,
            parseAttempt: {
              at: new Date().toISOString(),
              triggeredBy: requesterEmail,
              ok: false,
            },
            parseDiagnostics: {
              ...priorDiagnostics,
              isComplete: false,
              incompleteReason: `Reparse failed: ${details}`,
              failedAt: new Date().toISOString(),
            },
          },
          review: {
            ...(priorResults?.review && typeof priorResults.review === "object" ? priorResults.review : {}),
            status: "needs_review",
            updatedAt: new Date().toISOString(),
          },
        };

        const { error: failureUpdateErr } = await supabase
          .from(reportsTable)
          .update({ results_data: nextResultsDataOnFailure })
          .eq("id", report.id);

        if (failureUpdateErr) {
          console.log("[admin-import:reparse] Failed to persist reparse error diagnostics", {
            reportId: report.id,
            details: failureUpdateErr.message,
          });
        }
      } catch (persistError) {
        console.log("[admin-import:reparse] Unexpected error persisting reparse failure diagnostics", {
          reportId: report.id,
          details: String(persistError?.message || persistError),
        });
      }
    }

    return NextResponse.json(
      {
        error: "Failed to reparse report",
        details,
        reportId,
        reportsTable,
        parseCoverage: {
          parsedPages: null,
          detectedTotalPages: null,
          minExpectedPages: null,
          isCoverageComplete: false,
        },
        verificationSummary: {
          available: false,
          mismatchCount: 0,
          criticalMismatchCount: 0,
          criticalMismatchKeys: [],
        },
        parseState: "failed",
        parseReason: details,
      },
      { status: 500 },
    );
  }
}
