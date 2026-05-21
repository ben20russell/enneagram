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
    const isReportReady = hasAssignedPdfMetadata && isPdfRenderable;

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
