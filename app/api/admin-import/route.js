import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { createReport, getReportById } from "../../../lib/reportsStore";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../../lib/supabaseAdmin";
import { authOptions } from "../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../lib/adminAccess";

export const runtime = "nodejs";
export const maxDuration = 300;

function sanitizeFileName(name) {
  return String(name || "report.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function isPdfFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function splitStoragePath(storagePath) {
  const normalized = String(storagePath || "").replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.pop() || "";
  const folder = parts.join("/");
  return { folder, fileName };
}

function inferTypeFromFileName(fileName) {
  const normalized = String(fileName || "");
  const ieqMatch = normalized.match(/iEQ\s*([1-9])\b/i);
  if (ieqMatch?.[1]) {
    return { detectedType: ieqMatch[1], detectionSource: "fileName:iEQ" };
  }

  const typeMatch = normalized.match(/Type[\s_-]*([1-9])\b/i);
  if (typeMatch?.[1]) {
    return { detectedType: typeMatch[1], detectionSource: "fileName:type" };
  }

  return { detectedType: null, detectionSource: "none" };
}

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
  const criticalHydrated = Number(diagnostics?.sectionCoverage?.criticalHydrated ?? 0);
  const criticalTotal = Number(diagnostics?.sectionCoverage?.criticalTotal ?? 0);
  const hasCriticalSections = criticalTotal > 0 ? criticalHydrated >= criticalTotal : true;
  const isComplete = hasMinPages && hasAllChartScores && hasCriticalSections;
  let incompleteReason = null;
  if (!hasMinPages) {
    incompleteReason = `Extracted ${pages} pages, expected at least ${minPages}`;
  } else if (!hasAllChartScores) {
    incompleteReason = "Chart numerics incomplete: one or more type, instinct, or center scores are null";
  } else if (!hasCriticalSections) {
    incompleteReason = `Critical section hydration incomplete (${criticalHydrated}/${criticalTotal})`;
  }
  return {
    isComplete,
    incompleteReason,
    pages,
    minPages,
    typeNonNull,
    instinctNonNull,
    centerNonNull,
    criticalHydrated,
    criticalTotal,
  };
}

function buildIngestedResultsData({ reportId, safeFileName, storagePath, bucket, sizeBytes, mimeType }) {
  const { detectedType, detectionSource } = inferTypeFromFileName(safeFileName);

  return {
    ingestion: {
      status: "incomplete",
      mode: "admin-import-auto",
      ingestedAt: new Date().toISOString(),
      reportId,
      parseDiagnostics: {
        isComplete: false,
        incompleteReason: "Report metadata imported; parsed profile not yet available.",
        extraction: {
          pages: 0,
          minExpectedPages: Number(process.env.PDF_PARSE_MIN_PAGES || 20),
        },
      },
    },
    dashboardContext: {
      detectedType,
      detectedTypeSource: detectionSource,
      sourceFileName: safeFileName,
      basicFear: null,
      basicDesire: null,
      passion: null,
    },
    review: {
      status: "needs_review",
      pendingFields: [],
      generatedAt: new Date().toISOString(),
    },
    file: {
      bucket,
      storagePath,
      fileName: safeFileName,
      sizeBytes,
      mimeType: mimeType || "application/pdf",
    },
  };
}

function buildParsedResultsData({
  reportId,
  safeFileName,
  storagePath,
  bucket,
  sizeBytes,
  mimeType,
  parsed,
}) {
  const parseDiagnostics =
    parsed && typeof parsed === "object" && parsed._parseDiagnostics && typeof parsed._parseDiagnostics === "object"
      ? parsed._parseDiagnostics
      : null;
  const parseReview =
    parsed && typeof parsed === "object" && parsed._review && typeof parsed._review === "object"
      ? parsed._review
      : null;
  const recomputed = computeCompletenessFromParsed(parsed, parseDiagnostics);
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
  };
  const parseStatus = recomputed.isComplete ? "complete" : "incomplete";
  const reviewStatus = parseReview?.status || (recomputed.isComplete ? "auto_approved" : "needs_review");
  const fallbackType = inferTypeFromFileName(safeFileName).detectedType;

  return {
    ingestion: {
      status: parseStatus === "complete" && reviewStatus !== "needs_review" ? "ready" : "incomplete",
      mode: "admin-import-auto",
      ingestedAt: new Date().toISOString(),
      reportId,
      parser: {
        provider: "azure-openai",
        model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini",
      },
      parseDiagnostics: nextDiagnostics,
    },
    dashboardContext: {
      detectedType: parsed?.primaryType ? String(parsed.primaryType) : fallbackType,
      detectedTypeSource: `azure-openai:${process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini"}`,
      sourceFileName: safeFileName,
      basicFear: parsed?.coreFear || null,
      basicDesire: parsed?.coreDesire || null,
      passion: parsed?.passion || null,
      integrationLevel: parsed?.integrationLevel || null,
      instinct: parsed?.instinctualVariant || null,
      reportSummary: parsed?.reportSummary || null,
    },
    review: {
      ...(parseReview || {}),
      status: reviewStatus,
      updatedAt: new Date().toISOString(),
    },
    extractedContent: {
      documentSummary: parsed?.reportContent?.documentSummary || null,
      pages: Array.isArray(parsed?.reportContent?.pages) ? parsed.reportContent.pages : [],
      sections: Array.isArray(parsed?.reportContent?.sections) ? parsed.reportContent.sections : [],
      extractedAt: new Date().toISOString(),
      parserVersion: nextDiagnostics?.parserVersion || "multi-pass-v3",
    },
    parsedProfile: parsed,
    file: {
      bucket,
      storagePath,
      fileName: safeFileName,
      sizeBytes,
      mimeType: mimeType || "application/pdf",
    },
  };
}

async function assertAdminRequest() {
  const session = await getServerSession(authOptions);
  const requesterEmail = normalizeEmail(session?.user?.email);

  if (!session || !requesterEmail || !hasAdminAccess(requesterEmail)) {
    return { requesterEmail, isAuthorized: false };
  }

  return { requesterEmail, isAuthorized: true };
}

async function ensureSupabaseFileExists({ supabaseAdmin, bucket, storagePath }) {
  const { folder, fileName } = splitStoragePath(storagePath);
  if (!fileName) return false;

  const { data, error } = await supabaseAdmin.storage.from(bucket).list(folder || undefined, {
    search: fileName,
    limit: 10,
  });

  if (error) {
    throw new Error(`Unable to verify uploaded PDF: ${error.message}`);
  }

  return (data || []).some((item) => item?.name === fileName);
}

async function finalizeImport({
  requesterEmail,
  reportId,
  userEmail,
  safeFileName,
  storagePath,
  mimeType,
  sizeBytes,
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const bucket = getSupabaseStorageBucket();

  const exists = await ensureSupabaseFileExists({
    supabaseAdmin,
    bucket,
    storagePath,
  });

  if (!exists) {
    console.log("[admin-import] Finalize failed, storage object missing", {
      reportId,
      bucket,
      storagePath,
    });
    return NextResponse.json(
      { error: "Uploaded PDF not found in storage. Please retry upload." },
      { status: 400 },
    );
  }

  const existingReport = await getReportById(reportId);

  if (existingReport) {
    console.log("[admin-import] Finalize rejected, report already exists", { reportId });
    return NextResponse.json({ error: "Report already imported" }, { status: 409 });
  }

  let resultsData = buildIngestedResultsData({
    reportId,
    safeFileName,
    storagePath,
    bucket,
    sizeBytes,
    mimeType,
  });
  let parsedPrimaryType = inferTypeFromFileName(safeFileName).detectedType;
  const shouldParseOnFinalize =
    String(process.env.ADMIN_IMPORT_PARSE_ON_FINALIZE || "").toLowerCase() === "true";

  if (shouldParseOnFinalize) {
    try {
      console.log("[admin-import] Starting parse for imported report", {
        reportId,
        userEmail,
        bucket,
        storagePath,
        fileName: safeFileName,
        sizeBytes,
      });
      const { data: fileBlob, error: downloadErr } = await supabaseAdmin.storage.from(bucket).download(storagePath);
      if (downloadErr || !fileBlob) {
        throw new Error(`Failed to download uploaded PDF for parsing: ${downloadErr?.message || "unknown error"}`);
      }
      const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());
      const { parsePdf } = await import("../../../lib/parsePdf.js");
      const parsed = await parsePdf(pdfBuffer, {
        disableImagePipeline: true,
        disableImageScoreRescue: true,
        allowLocalTextFallback: true,
      });
      parsedPrimaryType = parsed?.primaryType ? String(parsed.primaryType) : parsedPrimaryType;
      resultsData = buildParsedResultsData({
        reportId,
        safeFileName,
        storagePath,
        bucket,
        sizeBytes,
        mimeType,
        parsed,
      });
      console.log("[admin-import] Parse completed", {
        reportId,
        parsedPrimaryType,
        parseStatus: resultsData?.ingestion?.status || null,
        parsePages: resultsData?.ingestion?.parseDiagnostics?.extraction?.pages ?? null,
        parseMinExpectedPages: resultsData?.ingestion?.parseDiagnostics?.extraction?.minExpectedPages ?? null,
        parseDetectedTotalPages:
          resultsData?.ingestion?.parseDiagnostics?.extraction?.detectedTotalPages ?? null,
      });
    } catch (error) {
      console.log("[admin-import] Parse failed; keeping metadata-only import", {
        reportId,
        details: String(error?.message || error),
      });
      resultsData = {
        ...resultsData,
        ingestion: {
          ...(resultsData.ingestion || {}),
          status: "incomplete",
          parseDiagnostics: {
            ...(resultsData?.ingestion?.parseDiagnostics || {}),
            isComplete: false,
            incompleteReason: `Parsing failed: ${String(error?.message || "unknown parse error")}`,
          },
        },
      };
    }
  } else {
    console.log("[admin-import] Skipping parse during finalize; using metadata-only import", {
      reportId,
      parseFlagEnv: process.env.ADMIN_IMPORT_PARSE_ON_FINALIZE || null,
    });
  }

  const report = await createReport({
    id: reportId,
    userEmail,
    enneagramType: parsedPrimaryType,
    wing: null,
    resultsData,
    reportPdf: {
      fileName: safeFileName,
      mimeType: mimeType || "application/pdf",
      sizeBytes,
      storageProvider: "supabase",
      bucket,
      storagePath,
      uploadedBy: requesterEmail,
    },
    source: "admin-import",
  });

  console.log("[admin-import] Report imported successfully", {
    id: report.id,
    storageProvider: "supabase",
    bucket,
    storagePath,
    sizeBytes,
  });

  return NextResponse.json(
    {
      id: report.id,
      message: `Successfully imported and assigned report to ${userEmail}`,
    },
    { status: 200 },
  );
}

async function reparseImportedReport({ requesterEmail, reportId }) {
  const normalizedReportId = String(reportId || "").trim();
  if (!normalizedReportId) {
    return NextResponse.json({ error: "Missing reportId" }, { status: 400 });
  }

  const reportsTable = process.env.SUPABASE_REPORTS_TABLE || "reports";
  const supabase = getSupabaseAdmin();
  let report = null;

  try {
    const { data: loadedReport, error: reportErr } = await supabase
      .from(reportsTable)
      .select("id,user_email,enneagram_type,results_data,report_pdf")
      .eq("id", normalizedReportId)
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
    const { parsePdf } = await import("../../../lib/parsePdf.js");
    const parsed = await parsePdf(pdfBuffer, {
      disableImagePipeline: true,
      disableImageScoreRescue: true,
      allowLocalTextFallback: true,
    });

    const parseDiagnostics =
      parsed && typeof parsed === "object" && parsed._parseDiagnostics && typeof parsed._parseDiagnostics === "object"
        ? parsed._parseDiagnostics
        : null;
    const parseReview =
      parsed && typeof parsed === "object" && parsed._review && typeof parsed._review === "object"
        ? parsed._review
        : null;

    const recomputed = computeCompletenessFromParsed(parsed, parseDiagnostics);
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
      completedAt: new Date().toISOString(),
    };

    const parseStatus = recomputed.isComplete ? "complete" : "incomplete";
    const reviewStatus = parseReview?.status || (recomputed.isComplete ? "auto_approved" : "needs_review");

    const priorResults = report?.results_data && typeof report.results_data === "object" ? report.results_data : {};
    const priorDashboardContext =
      priorResults?.dashboardContext && typeof priorResults.dashboardContext === "object"
        ? priorResults.dashboardContext
        : {};

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
        detectedType: parsed?.primaryType
          ? String(parsed.primaryType)
          : inferTypeFromFileName(fileName).detectedType,
        detectedTypeSource: `azure-openai:${process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini"}`,
        sourceFileName: fileName,
        basicFear: parsed?.coreFear || null,
        basicDesire: parsed?.coreDesire || null,
        passion: priorDashboardContext?.passion || null,
        integrationLevel: parsed?.integrationLevel || null,
        instinct: parsed?.instinctualVariant || null,
        reportSummary: parsed?.reportSummary || null,
      },
      extractedContent: {
        ...(priorResults?.extractedContent || {}),
        documentSummary: parsed?.reportContent?.documentSummary || null,
        pages: Array.isArray(parsed?.reportContent?.pages) ? parsed.reportContent.pages : [],
        sections: Array.isArray(parsed?.reportContent?.sections) ? parsed.reportContent.sections : [],
        extractedAt: new Date().toISOString(),
        parserVersion: nextDiagnostics?.parserVersion || "multi-pass-v3",
      },
      parsedProfile: parsed,
    };

    const { error: updateErr } = await supabase
      .from(reportsTable)
      .update({
        results_data: nextResultsData,
        enneagram_type: parsed?.primaryType ? String(parsed.primaryType) : report.enneagram_type,
      })
      .eq("id", report.id);

    if (updateErr) {
      throw new Error(`Failed to update report parse results: ${updateErr.message}`);
    }

    console.log("[admin-import] Reparse completed and saved", {
      reportId: report.id,
      parseStatus,
      reviewStatus,
      parsePages: nextDiagnostics?.extraction?.pages ?? null,
      parseMinExpectedPages: nextDiagnostics?.extraction?.minExpectedPages ?? null,
      parseDetectedTotalPages: nextDiagnostics?.extraction?.detectedTotalPages ?? null,
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
      },
      { status: 200 },
    );
  } catch (error) {
    const details = String(error?.message || "Unknown reparse error");
    console.log("[admin-import] Failed to reparse report", {
      reportId: normalizedReportId,
      details,
      stack: error?.stack,
    });

    if (report?.id) {
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
          console.log("[admin-import] Failed to persist reparse error diagnostics", {
            reportId: report.id,
            details: failureUpdateErr.message,
          });
        }
      } catch (persistError) {
        console.log("[admin-import] Unexpected error persisting reparse failure diagnostics", {
          reportId: report.id,
          details: String(persistError?.message || persistError),
        });
      }
    }

    return NextResponse.json(
      { error: "Failed to reparse report", details, reportId: normalizedReportId, reportsTable },
      { status: 500 },
    );
  }
}

async function handleFinalizeJson(body, requesterEmail) {
  const action = String(body?.action || "").trim().toLowerCase();
  if (action === "reparse") {
    return reparseImportedReport({
      requesterEmail,
      reportId: body?.reportId,
    });
  }

  const reportId = String(body?.reportId || "").trim();
  const userEmail = normalizeEmail(body?.userEmail);
  const storagePath = String(body?.storagePath || "").trim();
  const mimeType = String(body?.mimeType || "application/pdf").toLowerCase();
  const sizeBytes = Number(body?.sizeBytes || 0);
  const safeFileName = sanitizeFileName(body?.safeFileName || "report.pdf");

  if (!reportId || !userEmail || !storagePath || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    console.log("[admin-import] Missing finalize fields", {
      hasReportId: !!reportId,
      hasUserEmail: !!userEmail,
      hasStoragePath: !!storagePath,
      sizeBytes,
    });
    return NextResponse.json(
      { error: "Missing finalize fields for report import" },
      { status: 400 },
    );
  }

  if (mimeType !== "application/pdf" && !safeFileName.toLowerCase().endsWith(".pdf")) {
    console.log("[admin-import] Finalize rejected non-PDF metadata", {
      mimeType,
      safeFileName,
    });
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  return finalizeImport({
    requesterEmail,
    reportId,
    userEmail,
    safeFileName,
    storagePath,
    mimeType,
    sizeBytes,
  });
}

async function handleLegacyMultipart(req, requesterEmail) {
  const supabaseAdmin = getSupabaseAdmin();
  const bucket = getSupabaseStorageBucket();

  let formData;
  try {
    formData = await req.formData();
    console.log("[admin-import] Parsed multipart form data (legacy path)");
  } catch (error) {
    console.log("[admin-import] Failed to parse multipart form data:", error);
    return NextResponse.json({ error: "Invalid form payload" }, { status: 400 });
  }

  const userEmail = normalizeEmail(formData.get("userEmail"));
  const reportPdf = formData.get("reportPdf");

  if (!userEmail || !reportPdf) {
    console.log("[admin-import] Missing required fields", {
      hasUserEmail: !!userEmail,
      hasReportPdf: !!reportPdf,
    });
    return NextResponse.json(
      { error: "Missing user email or PDF upload" },
      { status: 400 },
    );
  }

  if (!(reportPdf instanceof File)) {
    console.log("[admin-import] Uploaded report is not a File");
    return NextResponse.json({ error: "Invalid PDF upload" }, { status: 400 });
  }

  if (!isPdfFile(reportPdf)) {
    console.log("[admin-import] Non-PDF file upload attempted", {
      fileName: reportPdf.name,
      fileType: reportPdf.type,
    });
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  const reportId = randomUUID();
  const safeFileName = sanitizeFileName(reportPdf.name || "report.pdf");
  const storagePath = `${reportId}/${safeFileName}`;

  try {
    const { error } = await supabaseAdmin.storage.from(bucket).upload(storagePath, reportPdf, {
      contentType: "application/pdf",
      upsert: false,
    });

    if (error) {
      throw new Error(error.message || "Supabase upload failed");
    }

    return finalizeImport({
      requesterEmail,
      reportId,
      userEmail,
      safeFileName,
      storagePath,
      mimeType: "application/pdf",
      sizeBytes: reportPdf.size,
    });
  } catch (error) {
    const details = String(error?.message || "Unknown legacy upload error");
    console.log("[admin-import] Failed legacy multipart import", {
      details,
      stack: error?.stack,
    });
    return NextResponse.json(
      { error: "Failed to import", details },
      { status: 500 },
    );
  }
}

export async function POST(req) {
  console.log("[admin-import] Incoming POST request");

  const { requesterEmail, isAuthorized } = await assertAdminRequest();
  if (!isAuthorized) {
    console.log("[admin-import] Unauthorized requester", {
      requesterEmail,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = String(req.headers.get("content-type") || "").toLowerCase();

  try {
    if (contentType.includes("application/json")) {
      let body;
      try {
        body = await req.json();
        console.log("[admin-import] Parsed JSON payload", {
          action: String(body?.action || "").trim().toLowerCase() || "finalize",
        });
      } catch (error) {
        console.log("[admin-import] Failed to parse JSON payload", error);
        return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
      }

      return await handleFinalizeJson(body, requesterEmail);
    }

    return await handleLegacyMultipart(req, requesterEmail);
  } catch (error) {
    const details = String(error?.message || "Unknown import error");
    const reportsTable = process.env.SUPABASE_REPORTS_TABLE || "reports";
    console.log("[admin-import] Failed to import report:", {
      details,
      reportsTable,
      contentType,
      stack: error?.stack,
    });
    return NextResponse.json(
      { error: "Failed to import", details, reportsTable, contentType },
      { status: 500 },
    );
  }
}
