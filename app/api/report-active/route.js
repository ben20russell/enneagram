import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getAssignedReportByUserEmail } from "../../../lib/reportsStore";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../../lib/supabaseAdmin";
import { hasAdminAccess, normalizeEmail } from "../../../lib/adminAccess";
import { authOptions } from "../auth/[...nextauth]/route";

function isLocalhostHostValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "localhost" ||
    normalized.startsWith("localhost:") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.0.0.1:") ||
    normalized === "[::1]" ||
    normalized.startsWith("[::1]:")
  );
}

function parseHostFromHeaderValue(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  try {
    return String(new URL(rawValue).host || "").toLowerCase();
  } catch (_error) {
    return rawValue.toLowerCase();
  }
}

function isLocalhostPreviewRequest(request) {
  const hostHeader = request?.headers?.get("host") || "";
  if (isLocalhostHostValue(hostHeader)) return true;

  const originHeader = request?.headers?.get("origin") || "";
  if (isLocalhostHostValue(parseHostFromHeaderValue(originHeader))) return true;

  const refererHeader = request?.headers?.get("referer") || "";
  if (isLocalhostHostValue(parseHostFromHeaderValue(refererHeader))) return true;

  return false;
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

function normalizeIdentityContextValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (
    lowered === "not detected" ||
    lowered.startsWith("not detected in assigned pdf") ||
    lowered.startsWith("not detected in parsed pdf text") ||
    lowered === "unknown"
  ) {
    return null;
  }
  return normalized;
}

function getVerificationResolvedFields(normalized) {
  const ingestionVerification = normalized?.ingestion?.parseDiagnostics?.verification;
  if (ingestionVerification && typeof ingestionVerification === "object") {
    const resolved = ingestionVerification?.resolvedFields;
    if (resolved && typeof resolved === "object") return resolved;
  }
  const parsedVerification = normalized?.parsedProfile?._parseDiagnostics?.verification;
  if (parsedVerification && typeof parsedVerification === "object") {
    const resolved = parsedVerification?.resolvedFields;
    if (resolved && typeof resolved === "object") return resolved;
  }
  return {};
}

function getIngestedDashboardContext(resultsData) {
  const normalized = normalizeResultsData(resultsData);
  if (!normalized) return null;
  const parsed = typeof normalized.parsedProfile === "object" && normalized.parsedProfile
    ? normalized.parsedProfile
    : null;
  const verificationResolvedFields = getVerificationResolvedFields(normalized);
  const resolvedPrimaryType =
    normalizeTypeNumber(verificationResolvedFields?.primaryType) ??
    normalizeTypeNumber(parsed?.primaryType);
  const resolvedInstinctualVariant =
    normalizeInstinctualVariant(verificationResolvedFields?.instinctualVariant) ??
    normalizeInstinctualVariant(parsed?.instinctualVariant);
  const resolvedIntegrationLevel =
    normalizeIntegrationLevel(verificationResolvedFields?.integrationLevel) ??
    normalizeIntegrationLevel(parsed?.integrationLevel);

  if (typeof normalized.dashboardContext === "object" && normalized.dashboardContext) {
    const dashboardDetectedType = normalizeTypeNumber(normalized.dashboardContext?.detectedType);
    const dashboardInstinctualVariant = normalizeInstinctualVariant(
      normalizeIdentityContextValue(
        normalized.dashboardContext?.instinct || normalized.dashboardContext?.instinctCode,
      ),
    );
    const dashboardIntegrationLevel = normalizeIntegrationLevel(
      normalizeIdentityContextValue(
        normalized.dashboardContext?.integrationLevel || normalized.dashboardContext?.integration,
      ),
    );

    return {
      ...normalized.dashboardContext,
      detectedType:
        (resolvedPrimaryType != null ? String(resolvedPrimaryType) : null) ||
        (dashboardDetectedType != null ? String(dashboardDetectedType) : null),
      instinct: resolvedInstinctualVariant || dashboardInstinctualVariant,
      integrationLevel: resolvedIntegrationLevel || dashboardIntegrationLevel,
      basicFear:
        normalizeIdentityContextValue(normalized.dashboardContext?.basicFear) ||
        parsed?.coreFear ||
        null,
      basicDesire:
        normalizeIdentityContextValue(normalized.dashboardContext?.basicDesire) ||
        parsed?.coreDesire ||
        null,
      passion:
        normalizeIdentityContextValue(normalized.dashboardContext?.passion) ||
        parsed?.passion ||
        null,
    };
  }

  if (parsed) {
    return {
      detectedType: resolvedPrimaryType != null ? String(resolvedPrimaryType) : null,
      detectedTypeSource: "parsedProfile:primaryType",
      sourceFileName: normalized?.file?.fileName || null,
      basicFear: parsed?.coreFear || null,
      basicDesire: parsed?.coreDesire || null,
      passion: null,
      instinct: resolvedInstinctualVariant,
      integrationLevel: resolvedIntegrationLevel,
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
  const reviewState = normalized?.review && typeof normalized.review === "object" ? normalized.review : null;
  const pageCount = Number(parseDiagnostics?.extraction?.pages || 0);
  const minPages = Number(parseDiagnostics?.extraction?.minExpectedPages || 20);
  const meetsPageCoverage = pageCount >= minPages;
  const hasCoreIdentity = Boolean(parsedProfile?.primaryType || parsedProfile?.typeName);
  const verificationCriticalMismatchCount = Number(parseDiagnostics?.verification?.criticalMismatchCount ?? 0);
  const hasVerificationConsistency = verificationCriticalMismatchCount <= 0;
  const reviewApproved = !reviewState || reviewState.status === "auto_approved" || reviewState.status === "approved";
  const isComplete = status === "ready" && meetsPageCoverage && hasCoreIdentity && reviewApproved && hasVerificationConsistency;
  return {
    status,
    parseDiagnostics,
    isComplete,
    review: reviewState,
    verificationCriticalMismatchCount,
  };
}

function toTitleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lowered = word.toLowerCase();
      return lowered.charAt(0).toUpperCase() + lowered.slice(1);
    })
    .join(" ");
}

function deriveClientDisplayName({ parsedProfile, userEmail, reportFileName, rowIndex }) {
  const parsedProfileName = String(parsedProfile?.clientName || "").trim();
  if (parsedProfileName) return parsedProfileName;

  const normalizedEmail = normalizeEmail(userEmail);
  if (normalizedEmail.includes("@")) {
    const emailLocal = normalizedEmail.split("@")[0] || "";
    const formattedLocal = toTitleCaseWords(emailLocal.replace(/[._-]+/g, " ").trim());
    if (formattedLocal) return formattedLocal;
  }

  const cleanedFileName = String(reportFileName || "")
    .replace(/\.pdf$/i, "")
    .replace(/[._-]+/g, " ")
    .trim();
  if (cleanedFileName) return cleanedFileName;

  return `Client ${rowIndex + 1}`;
}

async function createSignedPdfAccess({ supabaseAdmin, reportPdf, userEmail, reportId, logPrefix }) {
  const hasPdfMetadata =
    Boolean(reportPdf?.fileName) &&
    Boolean(reportPdf?.storagePath);

  if (!hasPdfMetadata) {
    return {
      isPdfRenderable: false,
      reportSignedUrl: null,
      reportActiveErrorDetails: null,
    };
  }

  const bucket = reportPdf?.bucket || getSupabaseStorageBucket();
  const storagePath = reportPdf.storagePath;
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60);

  if (error) {
    console.log(`[report-active] ${logPrefix} signed URL creation failed`, {
      reportId: reportId || null,
      userEmail,
      bucket,
      storagePath,
      supabaseErrorMessage: error?.message || null,
      supabaseErrorName: error?.name || null,
      supabaseErrorStatusCode: error?.statusCode || null,
    });
  }

  return {
    isPdfRenderable: Boolean(data?.signedUrl) && !error,
    reportSignedUrl: data?.signedUrl || null,
    reportActiveErrorDetails: error
      ? {
          bucket,
          storagePath,
          supabaseErrorMessage: error?.message || null,
          supabaseErrorName: error?.name || null,
          supabaseErrorStatusCode: error?.statusCode || null,
        }
      : null,
  };
}

async function listAdminClientReports({ supabaseAdmin }) {
  const table = process.env.SUPABASE_REPORTS_TABLE || "reports";
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id,user_email,created_at,source,results_data,report_pdf")
    .eq("source", "admin-import")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.log("[report-active] Failed to list admin client reports", {
      table,
      supabaseErrorMessage: error?.message || null,
      supabaseErrorName: error?.name || null,
      supabaseErrorStatusCode: error?.statusCode || null,
    });
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  const mapped = await Promise.all(
    rows.map(async (row, index) => {
      const parsedProfile = getParsedProfile(row?.results_data);
      const ingestionState = getIngestionState(row?.results_data);
      const signedPdfAccess = await createSignedPdfAccess({
        supabaseAdmin,
        reportPdf: row?.report_pdf,
        userEmail: row?.user_email,
        reportId: row?.id,
        logPrefix: "admin client report",
      });

      return {
        id: row?.id || null,
        userEmail: row?.user_email || null,
        clientName: deriveClientDisplayName({
          parsedProfile,
          userEmail: row?.user_email,
          reportFileName: row?.report_pdf?.fileName,
          rowIndex: index,
        }),
        reportFileName: row?.report_pdf?.fileName || null,
        source: row?.source || null,
        createdAt: row?.created_at || null,
        isPdfRenderable: signedPdfAccess.isPdfRenderable,
        reportSignedUrl: signedPdfAccess.reportSignedUrl,
        ingestedDashboardContext: getIngestedDashboardContext(row?.results_data),
        ingestedParsedProfile: parsedProfile,
        ingestionStatus: ingestionState.status,
        parseDiagnostics: ingestionState.parseDiagnostics,
        reviewStatus: ingestionState.review?.status || null,
        reviewPendingFields: Array.isArray(ingestionState.review?.pendingFields)
          ? ingestionState.review.pendingFields
          : [],
      };
    }),
  );

  return mapped.filter((item) => Boolean(item?.id));
}

export async function GET(request) {
  const isLocalhostPreview = isLocalhostPreviewRequest(request);
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;

  if (!userEmail && !isLocalhostPreview) {
    return NextResponse.json(
      {
        isAuthenticated: false,
        isAdmin: false,
        adminClientReports: [],
        isReportActive: false,
      },
      { status: 200 },
    );
  }

  const normalizedUserEmail = normalizeEmail(userEmail);
  const isAdmin = hasAdminAccess(normalizeEmail(userEmail));
  const canAccessAdminClientReports = isAdmin || isLocalhostPreview;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const adminClientReports = canAccessAdminClientReports
      ? await listAdminClientReports({ supabaseAdmin })
      : [];

    if (!userEmail) {
      return NextResponse.json(
        {
          isAuthenticated: false,
          isAdmin: false,
          adminClientReports: canAccessAdminClientReports ? adminClientReports : [],
          hasAssignedReport: false,
          isReportActive: false,
          isAssignedReportReady: false,
          isPdfRenderable: false,
        },
        { status: 200 },
      );
    }

    const assignedReport = await getAssignedReportByUserEmail(userEmail);
    const hasAssignedPdfMetadata =
      Boolean(assignedReport?.id) &&
      Boolean(assignedReport?.reportPdf?.fileName) &&
      Boolean(assignedReport?.reportPdf?.storagePath);

    if (!hasAssignedPdfMetadata) {
      return NextResponse.json(
        {
          isAuthenticated: true,
          isAdmin,
          adminClientReports: canAccessAdminClientReports ? adminClientReports : [],
          hasAssignedReport: false,
          isReportActive: false,
          isAssignedReportReady: false,
          isPdfRenderable: false,
          reportFileName: assignedReport?.reportPdf?.fileName || null,
        },
        { status: 200 },
      );
    }

    const signedPdfAccess = await createSignedPdfAccess({
      supabaseAdmin,
      reportPdf: assignedReport?.reportPdf,
      userEmail: normalizedUserEmail,
      reportId: assignedReport?.id,
      logPrefix: "assigned report",
    });
    const ingestionState = getIngestionState(assignedReport?.resultsData);
    const isReportActive = hasAssignedPdfMetadata && signedPdfAccess.isPdfRenderable && ingestionState.isComplete;

    return NextResponse.json(
      {
        isAuthenticated: true,
        isAdmin,
        adminClientReports: canAccessAdminClientReports ? adminClientReports : [],
        hasAssignedReport: hasAssignedPdfMetadata,
        isReportActive,
        isAssignedReportReady: isReportActive,
        isPdfRenderable: signedPdfAccess.isPdfRenderable,
        reportFileName: assignedReport?.reportPdf?.fileName || null,
        reportSignedUrl: signedPdfAccess.reportSignedUrl,
        ingestedDashboardContext: getIngestedDashboardContext(assignedReport?.resultsData),
        ingestedParsedProfile: getParsedProfile(assignedReport?.resultsData),
        ingestionStatus: ingestionState.status,
        parseDiagnostics: ingestionState.parseDiagnostics,
        reviewStatus: ingestionState.review?.status || null,
        reviewPendingFields: Array.isArray(ingestionState.review?.pendingFields)
          ? ingestionState.review.pendingFields
          : [],
        reportActiveErrorDetails: signedPdfAccess.reportActiveErrorDetails,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        isAuthenticated: Boolean(userEmail),
        isAdmin,
        adminClientReports: [],
        hasAssignedReport: false,
        isReportActive: false,
        isAssignedReportReady: false,
        error: String(error?.message || "Unknown report-active check error"),
      },
      { status: 200 },
    );
  }
}
