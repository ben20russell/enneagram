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

function countNonNull(obj) {
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).filter((v) => v != null).length;
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
    .select("id,results_data")
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
  const scoreUpdates = normalizeScores(body?.scores || {});
  const nextProfile = mergeScores(profile, scoreUpdates);
  const normalizedGroundTruthScores = normalizeScorePayload(nextProfile);
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

  const typeNonNull = countNonNull(nextProfile?.typeScores);
  const instinctNonNull = countNonNull(nextProfile?.instinctScores);
  const centerNonNull = countNonNull(nextProfile?.centerScores);
  const hasAllChartScores = typeNonNull === 9 && instinctNonNull === 3 && centerNonNull === 3;
  const diagnostics = results?.ingestion?.parseDiagnostics || {};
  const pageCount = Number(diagnostics?.extraction?.pages || 0);
  const minPages = Number(diagnostics?.extraction?.minExpectedPages || 20);
  const parseComplete = pageCount >= minPages && hasAllChartScores;

  const nextResults = {
    ...results,
    parsedProfile: nextProfile,
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
          : "Chart numerics incomplete: one or more type, instinct, or center scores are null",
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
        evaluation: mlEvaluation,
      },
    },
  };

  const { error: updateErr } = await supabase
    .from(table)
    .update({ results_data: nextResults })
    .eq("id", reportId);

  if (updateErr) {
    return NextResponse.json({ error: `Failed to save review: ${updateErr.message}` }, { status: 500 });
  }

  console.log("[admin-review] Saved review with ML feedback snapshot", {
    reportId,
    reviewedBy: admin.email,
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
