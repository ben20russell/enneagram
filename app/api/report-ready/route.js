import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getAssignedReportByUserEmail } from "../../../lib/reportsStore";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../../lib/supabaseAdmin";
import { authOptions } from "../auth/[...nextauth]/route";

function getIngestedDashboardContext(resultsData) {
  const normalized = normalizeResultsData(resultsData);
  if (!normalized) return null;

  if (typeof normalized.dashboardContext === "object" && normalized.dashboardContext) {
    return normalized.dashboardContext;
  }

  if (typeof normalized.parsedProfile === "object" && normalized.parsedProfile) {
    const parsed = normalized.parsedProfile;
    return {
      detectedType: parsed?.primaryType ? String(parsed.primaryType) : null,
      detectedTypeSource: "parsedProfile:primaryType",
      sourceFileName: normalized?.file?.fileName || null,
      basicFear: parsed?.coreFear || null,
      basicDesire: parsed?.coreDesire || null,
      passion: null,
      reportSummary: parsed?.reportSummary || null,
    };
  }

  return null;
}

function getParsedProfile(resultsData) {
  const normalized = normalizeResultsData(resultsData);
  if (!normalized) return null;
  if (typeof normalized.parsedProfile === "object" && normalized.parsedProfile) {
    return normalized.parsedProfile;
  }
  return null;
}

function normalizeResultsData(resultsData) {
  if (!resultsData) return null;
  if (typeof resultsData === "object") return resultsData;
  if (typeof resultsData === "string") {
    try {
      const parsed = JSON.parse(resultsData);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_error) {
      return null;
    }
  }
  return null;
}

function getIngestionState(resultsData) {
  const normalized = normalizeResultsData(resultsData);
  if (!normalized || typeof normalized !== "object") {
    return { status: null, parseDiagnostics: null, isComplete: false };
  }
  const ingestion = normalized.ingestion && typeof normalized.ingestion === "object" ? normalized.ingestion : {};
  const parseDiagnostics =
    ingestion.parseDiagnostics && typeof ingestion.parseDiagnostics === "object"
      ? ingestion.parseDiagnostics
      : normalized?.parsedProfile?._parseDiagnostics || null;
  const status = String(ingestion.status || "").toLowerCase() || null;
  const parsedProfile = normalized?.parsedProfile && typeof normalized.parsedProfile === "object"
    ? normalized.parsedProfile
    : null;
  const countNonNull = (obj) =>
    obj && typeof obj === "object" ? Object.values(obj).filter((v) => v != null).length : 0;
  const typeNonNull = countNonNull(parsedProfile?.typeScores);
  const instinctNonNull = countNonNull(parsedProfile?.instinctScores);
  const centerNonNull = countNonNull(parsedProfile?.centerScores);
  const hasAllChartScores = typeNonNull === 9 && instinctNonNull === 3 && centerNonNull === 3;
  const pageCount = Number(parseDiagnostics?.extraction?.pages || 0);
  const minPages = Number(parseDiagnostics?.extraction?.minExpectedPages || 20);
  const meetsPageCoverage = pageCount >= minPages;
  const isComplete = status === "ready" && meetsPageCoverage && hasAllChartScores;
  return { status, parseDiagnostics, isComplete };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;

  if (!userEmail) {
    return NextResponse.json(
      {
        isAuthenticated: false,
        isReportReady: false,
      },
      { status: 200 },
    );
  }

  try {
    const assignedReport = await getAssignedReportByUserEmail(userEmail);
    const hasAssignedPdfMetadata =
      Boolean(assignedReport?.id) &&
      Boolean(assignedReport?.reportPdf?.fileName) &&
      Boolean(assignedReport?.reportPdf?.storagePath);

    if (!hasAssignedPdfMetadata) {
      return NextResponse.json(
        {
          isAuthenticated: true,
          isReportReady: false,
          isPdfRenderable: false,
          reportFileName: assignedReport?.reportPdf?.fileName || null,
        },
        { status: 200 },
      );
    }

    const storagePath = assignedReport.reportPdf.storagePath;
    const bucket = assignedReport?.reportPdf?.bucket || getSupabaseStorageBucket();
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60);
    const isPdfRenderable = Boolean(data?.signedUrl) && !error;
    const ingestionState = getIngestionState(assignedReport?.resultsData);
    const isReportReady = hasAssignedPdfMetadata && isPdfRenderable && ingestionState.isComplete;

    if (error) {
      console.log("[report-ready] Signed URL creation failed", {
        userEmail,
        bucket,
        storagePath,
        supabaseErrorMessage: error?.message || null,
        supabaseErrorName: error?.name || null,
        supabaseErrorStatusCode: error?.statusCode || null,
      });
    }

    return NextResponse.json(
      {
        isAuthenticated: true,
        isReportReady,
        isPdfRenderable,
        reportFileName: assignedReport?.reportPdf?.fileName || null,
        reportSignedUrl: data?.signedUrl || null,
        ingestedDashboardContext: getIngestedDashboardContext(assignedReport?.resultsData),
        ingestedParsedProfile: getParsedProfile(assignedReport?.resultsData),
        ingestionStatus: ingestionState.status,
        parseDiagnostics: ingestionState.parseDiagnostics,
        reportReadyErrorDetails: error
          ? {
              bucket,
              storagePath,
              supabaseErrorMessage: error?.message || null,
              supabaseErrorName: error?.name || null,
              supabaseErrorStatusCode: error?.statusCode || null,
            }
          : null,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        isAuthenticated: true,
        isReportReady: false,
        error: String(error?.message || "Unknown report-ready check error"),
      },
      { status: 200 },
    );
  }
}
