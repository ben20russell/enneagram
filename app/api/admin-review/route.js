import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../lib/adminAccess";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import {
  aggregateMlFeedbackMetricsFromReportRows,
  buildScoreComparisonMetrics,
  normalizeScorePayload,
} from "../../../lib/mlScoreLearning";
import {
  inferReportTypeFromFileName,
  resolveMinExpectedPagesByReportType,
} from "../../../lib/reportTypePageThresholds";

const TYPE_SCORE_KEYS = [
  "type1",
  "type2",
  "type3",
  "type4",
  "type5",
  "type6",
  "type7",
  "type8",
  "type9",
];
const STD_MIN_EXPECTED_PAGES = 16;

function countNonNull(obj) {
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).filter((v) => v != null).length;
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
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "high") return "High";
  if (lowered === "moderate" || lowered === "medium") return "Moderate";
  if (lowered === "low") return "Low";
  return normalized;
}

function normalizeTypePointLabel(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const typeNumber = normalizeTypeNumber(normalized);
  if (typeNumber == null) return null;
  return `Type ${typeNumber}`;
}

function normalizeCoreIdentityPayload(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    primaryType: normalizeTypeNumber(source?.primaryType),
    typeName: normalizeOptionalString(source?.typeName ?? source?.mainTypeName),
    instinctualVariant: normalizeInstinctualVariant(source?.instinctualVariant ?? source?.dominantInstinct),
    subtypeKeyword: normalizeOptionalString(source?.subtypeKeyword),
    integrationLevel: normalizeIntegrationLevel(source?.integrationLevel),
    stretchPoint: normalizeTypePointLabel(source?.stretchPoint),
    releasePoint: normalizeTypePointLabel(source?.releasePoint),
  };
}

function resolvePrimaryTypeFromTypeScores(typeScores, fallbackPrimaryType = null) {
  const fallback = normalizeTypeNumber(fallbackPrimaryType);
  if (!typeScores || typeof typeScores !== "object") {
    return fallback != null ? String(fallback) : null;
  }

  let bestType = fallback;
  let bestScore = Number.NEGATIVE_INFINITY;

  TYPE_SCORE_KEYS.forEach((key) => {
    const score = Number(typeScores?.[key]);
    if (!Number.isFinite(score)) return;
    const typeNumber = normalizeTypeNumber(key);
    if (typeNumber == null) return;
    if (score > bestScore) {
      bestScore = score;
      bestType = typeNumber;
    }
  });

  return bestType != null ? String(bestType) : null;
}

function toScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return Math.round(n);
}

function roundMetric(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** Math.max(0, Math.floor(digits));
  return Math.round(numeric * factor) / factor;
}

function supportsIntegrationLevelForReport({ fileName, diagnostics }) {
  const inferredReportType = inferReportTypeFromFileName(fileName);
  if (inferredReportType === "STD") return false;
  if (inferredReportType === "PRO") return true;

  const extractionMinPages = Number(diagnostics?.extraction?.minExpectedPages || 0);
  if (Number.isFinite(extractionMinPages) && extractionMinPages > 0 && extractionMinPages <= STD_MIN_EXPECTED_PAGES) {
    return false;
  }

  return true;
}

function normalizeScores(input) {
  const out = {
    typeScores: {
      type1: null,
      type2: null,
      type3: null,
      type4: null,
      type5: null,
      type6: null,
      type7: null,
      type8: null,
      type9: null,
    },
    instinctScores: {
      selfPreservation: null,
      sexual: null,
      social: null,
    },
    centerScores: {
      head: null,
      heart: null,
      body: null,
    },
  };
  if (!input || typeof input !== "object") return out;

  Object.keys(out.typeScores).forEach((k) => {
    out.typeScores[k] = toScore(input?.typeScores?.[k]);
  });
  Object.keys(out.instinctScores).forEach((k) => {
    out.instinctScores[k] = toScore(input?.instinctScores?.[k]);
  });
  Object.keys(out.centerScores).forEach((k) => {
    out.centerScores[k] = toScore(input?.centerScores?.[k]);
  });
  return out;
}

function mergeScores(existingProfile, updates) {
  return {
    ...(existingProfile || {}),
    typeScores: {
      ...(existingProfile?.typeScores || {}),
      ...(updates?.typeScores || {}),
    },
    instinctScores: {
      ...(existingProfile?.instinctScores || {}),
      ...(updates?.instinctScores || {}),
    },
    centerScores: {
      ...(existingProfile?.centerScores || {}),
      ...(updates?.centerScores || {}),
    },
  };
}

async function assertAdmin() {
  const session = await getServerSession(authOptions);
  const email = normalizeEmail(session?.user?.email);
  if (!session || !email || !hasAdminAccess(email)) {
    return { ok: false, email };
  }
  return { ok: true, email };
}

export async function GET() {
  const admin = await assertAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const table = process.env.SUPABASE_REPORTS_TABLE || "reports";
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(table)
    .select("id,user_email,created_at,source,results_data,report_pdf")
    .eq("source", "admin-import")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: `Failed to list review queue: ${error.message}` }, { status: 500 });
  }

  const reportRows = Array.isArray(data) ? data : [];
  const allReports = reportRows
    .map((row) => {
      const results = row?.results_data && typeof row.results_data === "object" ? row.results_data : {};
      const profile = results?.parsedProfile && typeof results.parsedProfile === "object" ? results.parsedProfile : {};
      const review = results?.review && typeof results.review === "object" ? results.review : {};
      const diagnostics = results?.ingestion?.parseDiagnostics && typeof results.ingestion.parseDiagnostics === "object"
        ? results.ingestion.parseDiagnostics
        : {};
      const fileName =
        row?.report_pdf?.fileName ||
        results?.file?.fileName ||
        results?.dashboardContext?.sourceFileName ||
        null;
      const supportsIntegrationLevel = supportsIntegrationLevelForReport({ fileName, diagnostics });
      const feedbackIdentity = results?.ml?.feedback?.groundTruthIdentity &&
        typeof results.ml.feedback.groundTruthIdentity === "object"
        ? results.ml.feedback.groundTruthIdentity
        : {};
      const coreIdentity = normalizeCoreIdentityPayload({
        primaryType: feedbackIdentity?.primaryType ?? profile?.primaryType ?? row?.enneagram_type ?? null,
        typeName: feedbackIdentity?.typeName ?? profile?.typeName ?? null,
        instinctualVariant: feedbackIdentity?.instinctualVariant ?? profile?.instinctualVariant ?? null,
        subtypeKeyword: feedbackIdentity?.subtypeKeyword ?? profile?.subtypeKeyword ?? null,
        integrationLevel: supportsIntegrationLevel
          ? (feedbackIdentity?.integrationLevel ?? profile?.integrationLevel ?? null)
          : null,
        stretchPoint: feedbackIdentity?.stretchPoint ?? profile?.connectedLineB ?? null,
        releasePoint: feedbackIdentity?.releasePoint ?? profile?.connectedLineA ?? null,
      });
      const typeNonNull = countNonNull(profile?.typeScores);
      const instinctNonNull = countNonNull(profile?.instinctScores);
      const centerNonNull = countNonNull(profile?.centerScores);
      return {
        id: row.id,
        userEmail: row.user_email,
        createdAt: row.created_at,
        source: row.source,
        fileName: row?.report_pdf?.fileName || null,
        reviewStatus: review?.status || "needs_review",
        pendingFields: Array.isArray(review?.pendingFields) ? review.pendingFields : [],
        typeScores: profile?.typeScores || null,
        instinctScores: profile?.instinctScores || null,
        centerScores: profile?.centerScores || null,
        coreIdentity: {
          ...coreIdentity,
          supportsIntegrationLevel,
        },
        scoreCoverage: {
          typeNonNull,
          instinctNonNull,
          centerNonNull,
        },
      };
    });
  const queue = allReports.filter((item) => item.reviewStatus === "needs_review");
  const reviewedReports = allReports.filter((item) => item.reviewStatus !== "needs_review");
  const mlMetrics = aggregateMlFeedbackMetricsFromReportRows(reportRows);
  console.log("[admin-review] Loaded queue with ML metrics", {
    queueCount: queue.length,
    reviewedCount: reviewedReports.length,
    labeledReportCount: mlMetrics?.labeledReportCount ?? 0,
    parserMae: mlMetrics?.parserVsGroundTruth?.meanAbsoluteError ?? null,
    modelMae: mlMetrics?.modelVsGroundTruth?.meanAbsoluteError ?? null,
  });

  return NextResponse.json({ queue, reviewedReports, mlMetrics }, { status: 200 });
}

export async function POST(req) {
  const admin = await assertAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch (_error) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const reportId = String(body?.reportId || "").trim();
  if (!reportId) {
    return NextResponse.json({ error: "Missing reportId" }, { status: 400 });
  }

  const table = process.env.SUPABASE_REPORTS_TABLE || "reports";
  const supabase = getSupabaseAdmin();
  const { data: row, error: fetchErr } = await supabase
    .from(table)
    .select("id,enneagram_type,results_data,report_pdf")
    .eq("id", reportId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: `Failed to load report: ${fetchErr.message}` }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const results = row?.results_data && typeof row.results_data === "object" ? row.results_data : {};
  const profile = results?.parsedProfile && typeof results.parsedProfile === "object" ? results.parsedProfile : {};
  const diagnostics = results?.ingestion?.parseDiagnostics || {};
  const fileName =
    row?.report_pdf?.fileName ||
    results?.file?.fileName ||
    results?.dashboardContext?.sourceFileName ||
    null;
  const supportsIntegrationLevel = supportsIntegrationLevelForReport({ fileName, diagnostics });
  const scoreUpdates = normalizeScores(body?.scores || {});
  const requestedPrimaryType = normalizeTypeNumber(body?.primaryType ?? null);
  const coreIdentityInput = normalizeCoreIdentityPayload(body?.coreIdentity);
  const nextProfile = mergeScores(profile, scoreUpdates);
  const resolvedPrimaryType = resolvePrimaryTypeFromTypeScores(
    nextProfile?.typeScores,
    requestedPrimaryType ||
      coreIdentityInput?.primaryType ||
      nextProfile?.primaryType ||
      row?.enneagram_type ||
      results?.dashboardContext?.detectedType ||
      null,
  );
  const persistedEnneagramTypeNumber =
    normalizeTypeNumber(resolvedPrimaryType) ?? normalizeTypeNumber(row?.enneagram_type ?? null);
  const persistedEnneagramType =
    persistedEnneagramTypeNumber != null ? String(persistedEnneagramTypeNumber) : null;
  const nextProfileWithResolvedType = {
    ...nextProfile,
    primaryType: persistedEnneagramType || nextProfile?.primaryType || null,
  };
  const normalizedCoreIdentityProfileUpdates = {
    parsedProfile: {
      typeName: coreIdentityInput?.typeName || nextProfileWithResolvedType?.typeName || null,
      instinctualVariant: coreIdentityInput?.instinctualVariant || nextProfileWithResolvedType?.instinctualVariant || null,
      subtypeKeyword: coreIdentityInput?.subtypeKeyword || nextProfileWithResolvedType?.subtypeKeyword || null,
      integrationLevel: supportsIntegrationLevel
        ? (coreIdentityInput?.integrationLevel || nextProfileWithResolvedType?.integrationLevel || null)
        : null,
      connectedLineA: coreIdentityInput?.releasePoint || nextProfileWithResolvedType?.connectedLineA || null,
      connectedLineB: coreIdentityInput?.stretchPoint || nextProfileWithResolvedType?.connectedLineB || null,
    },
  };
  const persistedProfileWithIdentity = {
    ...nextProfileWithResolvedType,
    typeName: normalizedCoreIdentityProfileUpdates.parsedProfile.typeName,
    instinctualVariant: normalizedCoreIdentityProfileUpdates.parsedProfile.instinctualVariant,
    subtypeKeyword: normalizedCoreIdentityProfileUpdates.parsedProfile.subtypeKeyword,
    integrationLevel: normalizedCoreIdentityProfileUpdates.parsedProfile.integrationLevel,
    connectedLineA: normalizedCoreIdentityProfileUpdates.parsedProfile.connectedLineA,
    connectedLineB: normalizedCoreIdentityProfileUpdates.parsedProfile.connectedLineB,
  };
  const dashboardInstinct =
    persistedProfileWithIdentity?.instinctualVariant ||
    normalizeInstinctualVariant(results?.dashboardContext?.instinct) ||
    normalizeInstinctualVariant(results?.dashboardContext?.instinctCode) ||
    null;
  const dashboardIntegrationLevel = supportsIntegrationLevel
    ? (
      persistedProfileWithIdentity?.integrationLevel ||
      normalizeIntegrationLevel(results?.dashboardContext?.integrationLevel) ||
      normalizeIntegrationLevel(results?.dashboardContext?.integration) ||
      null
    )
    : null;
  const normalizedGroundTruthScores = normalizeScorePayload(nextProfileWithResolvedType);
  const parserVsGroundTruth = buildScoreComparisonMetrics({
    candidateScores: normalizeScorePayload(profile),
    groundTruthScores: normalizedGroundTruthScores,
  });
  const modelPredictionCandidate =
    results?.ingestion?.ml?.prediction?.scores && typeof results.ingestion.ml.prediction.scores === "object"
      ? results.ingestion.ml.prediction.scores
      : (results?.ingestion?.ml?.prediction && typeof results.ingestion.ml.prediction === "object"
        ? results.ingestion.ml.prediction
        : null);
  const modelVsGroundTruthCandidate = modelPredictionCandidate
    ? buildScoreComparisonMetrics({
      candidateScores: normalizeScorePayload(modelPredictionCandidate),
      groundTruthScores: normalizedGroundTruthScores,
    })
    : null;
  const modelVsGroundTruth = Number(modelVsGroundTruthCandidate?.totalCompared || 0) > 0
    ? modelVsGroundTruthCandidate
    : null;
  const parserMae = Number(parserVsGroundTruth?.meanAbsoluteError);
  const modelMae = Number(modelVsGroundTruth?.meanAbsoluteError);
  const hasComparableMae = Number.isFinite(parserMae) && Number.isFinite(modelMae) && parserMae > 0;
  const mlEvaluation = {
    parserVsGroundTruth,
    modelVsGroundTruth,
    absoluteMaeImprovement: hasComparableMae ? roundMetric(parserMae - modelMae, 4) : null,
    relativeMaeImprovementPercent: hasComparableMae
      ? roundMetric(((parserMae - modelMae) / parserMae) * 100, 3)
      : null,
  };

  const typeNonNull = countNonNull(nextProfileWithResolvedType?.typeScores);
  const instinctNonNull = countNonNull(nextProfileWithResolvedType?.instinctScores);
  const centerNonNull = countNonNull(nextProfileWithResolvedType?.centerScores);
  const hasAllChartScores = typeNonNull === 9 && instinctNonNull === 3 && centerNonNull === 3;
  const pageCount = Number(diagnostics?.extraction?.pages || 0);
  const minPages = resolveMinExpectedPagesByReportType({
    fileName,
    fallbackMinExpectedPages: diagnostics?.extraction?.minExpectedPages,
    defaultMinExpectedPages: Number(process.env.PDF_PARSE_MIN_PAGES || 20),
  });
  const hasMinPages = pageCount >= minPages;
  const parseComplete = hasMinPages && hasAllChartScores;
  const incompleteReason = !hasMinPages
    ? `Extracted ${pageCount} pages, expected at least ${minPages}`
    : "Chart numerics incomplete: one or more type, instinct, or center scores are null";

  const nextResultsBase = {
    ...results,
    parsedProfile: nextProfileWithResolvedType,
  };
  const nextResults = {
    ...nextResultsBase,
    parsedProfile: {
      ...nextProfileWithResolvedType,
      typeName: normalizedCoreIdentityProfileUpdates.parsedProfile.typeName,
      instinctualVariant: normalizedCoreIdentityProfileUpdates.parsedProfile.instinctualVariant,
      subtypeKeyword: normalizedCoreIdentityProfileUpdates.parsedProfile.subtypeKeyword,
      integrationLevel: normalizedCoreIdentityProfileUpdates.parsedProfile.integrationLevel,
      connectedLineA: normalizedCoreIdentityProfileUpdates.parsedProfile.connectedLineA,
      connectedLineB: normalizedCoreIdentityProfileUpdates.parsedProfile.connectedLineB,
    },
    dashboardContext: {
      ...(results?.dashboardContext || {}),
      detectedType: persistedEnneagramType || results?.dashboardContext?.detectedType || null,
      detectedTypeSource: persistedEnneagramType
        ? "admin-review:graded-type-scores"
        : (results?.dashboardContext?.detectedTypeSource || null),
      instinct: dashboardInstinct,
      instinctCode: dashboardInstinct,
      integrationLevel: dashboardIntegrationLevel,
      integration: dashboardIntegrationLevel,
      supportsIntegrationLevel,
    },
    review: {
      ...(results?.review || {}),
      status: parseComplete ? "approved" : "needs_review",
      pendingFields: parseComplete ? [] : (results?.review?.pendingFields || []),
      reviewedBy: admin.email,
      reviewedAt: new Date().toISOString(),
      notes: String(body?.notes || "").trim() || null,
    },
    ingestion: {
      ...(results?.ingestion || {}),
      status: parseComplete ? "ready" : "incomplete",
      parseDiagnostics: {
        ...(diagnostics || {}),
        isComplete: parseComplete,
        incompleteReason: parseComplete
          ? null
          : incompleteReason,
        verification: {
          ...(diagnostics?.verification || {}),
          resolvedFields: {
            ...(diagnostics?.verification?.resolvedFields || {}),
            primaryType:
              persistedEnneagramType ||
              diagnostics?.verification?.resolvedFields?.primaryType ||
              null,
            instinctualVariant:
              persistedProfileWithIdentity?.instinctualVariant ||
              diagnostics?.verification?.resolvedFields?.instinctualVariant ||
              null,
            integrationLevel: supportsIntegrationLevel
              ? (
                persistedProfileWithIdentity?.integrationLevel ||
                diagnostics?.verification?.resolvedFields?.integrationLevel ||
                null
              )
              : null,
          },
        },
        extraction: {
          ...(diagnostics?.extraction || {}),
          pages: pageCount,
          minExpectedPages: minPages,
        },
        scoreCoverage: {
          ...(diagnostics?.scoreCoverage || {}),
          typeScoresNonNull: typeNonNull,
          typeScoresTotal: 9,
          instinctScoresNonNull: instinctNonNull,
          instinctScoresTotal: 3,
          centerScoresNonNull: centerNonNull,
          centerScoresTotal: 3,
        },
      },
    },
    ml: {
      ...(results?.ml || {}),
      feedback: {
        ...(results?.ml?.feedback || {}),
        labelSource: "admin-review",
        labeledBy: admin.email,
        labeledAt: new Date().toISOString(),
        notes: String(body?.notes || "").trim() || null,
        groundTruthScores: normalizedGroundTruthScores,
        groundTruthIdentity: {
          primaryType: persistedEnneagramType || null,
          instinctualVariant: persistedProfileWithIdentity?.instinctualVariant || null,
          integrationLevel: supportsIntegrationLevel
            ? (persistedProfileWithIdentity?.integrationLevel || null)
            : null,
          subtypeKeyword: persistedProfileWithIdentity?.subtypeKeyword || null,
          stretchPoint: persistedProfileWithIdentity?.connectedLineB || null,
          releasePoint: persistedProfileWithIdentity?.connectedLineA || null,
          typeName: persistedProfileWithIdentity?.typeName || null,
        },
        evaluation: mlEvaluation,
      },
    },
  };

  const { error: updateErr } = await supabase
    .from(table)
    .update({
      results_data: nextResults,
      enneagram_type: persistedEnneagramTypeNumber,
    })
    .eq("id", reportId);

  if (updateErr) {
    return NextResponse.json({ error: `Failed to save review: ${updateErr.message}` }, { status: 500 });
  }

  console.log("[admin-review] Saved review with ML feedback snapshot", {
    reportId,
    reviewedBy: admin.email,
    resolvedPrimaryType: persistedEnneagramType,
    parseComplete,
    parserMae: mlEvaluation?.parserVsGroundTruth?.meanAbsoluteError ?? null,
    modelMae: mlEvaluation?.modelVsGroundTruth?.meanAbsoluteError ?? null,
    absoluteMaeImprovement: mlEvaluation?.absoluteMaeImprovement ?? null,
  });

  return NextResponse.json(
    {
      success: true,
      reportId,
      reviewStatus: nextResults.review.status,
      ingestionStatus: nextResults.ingestion.status,
      enneagramType: persistedEnneagramType,
      mlEvaluation,
      scoreCoverage: {
        typeNonNull,
        instinctNonNull,
        centerNonNull,
      },
    },
    { status: 200 },
  );
}
