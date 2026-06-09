import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../../lib/adminAccess";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { extractClientNameFromReportFileName } from "../../../../lib/reportFileNameClientName";

export const runtime = "nodejs";

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

const INSTINCT_SCORE_KEYS = ["selfPreservation", "sexual", "social"];
const CENTER_SCORE_KEYS = ["head", "heart", "body"];

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

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0 || numeric > 100) return null;
  return Math.round(numeric);
}

function normalizeScoreMap(scoreMap, keys) {
  const normalized = {};
  keys.forEach((key) => {
    normalized[key] = normalizeScore(scoreMap?.[key]);
  });
  return normalized;
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

function normalizeResultsData(resultsData) {
  if (!resultsData) return {};
  if (typeof resultsData === "object") return resultsData;
  if (typeof resultsData === "string") {
    try {
      const parsed = JSON.parse(resultsData);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_error) {
      return {};
    }
  }
  return {};
}

function shouldBackfillRow(row) {
  const results = normalizeResultsData(row?.results_data);
  const review = results?.review && typeof results.review === "object" ? results.review : {};
  const feedback = results?.ml?.feedback && typeof results.ml.feedback === "object" ? results.ml.feedback : {};
  const status = String(review?.status || "").toLowerCase();
  if (status === "approved" || status === "auto_approved") return true;
  if (review?.reviewedAt || review?.reviewedBy) return true;
  return String(feedback?.labelSource || "").toLowerCase() === "admin-review";
}

function buildBackfilledRow(row, adminEmail) {
  const nowIso = new Date().toISOString();
  const results = normalizeResultsData(row?.results_data);
  const profile = results?.parsedProfile && typeof results.parsedProfile === "object" ? results.parsedProfile : null;
  if (!profile) {
    return { skipReason: "missing_parsed_profile" };
  }
  const fileNameClientName = extractClientNameFromReportFileName(
    row?.report_pdf?.fileName || results?.file?.fileName || null,
  );
  const parsedClientName = String(profile?.clientName || "").trim() || null;
  const resolvedClientName = parsedClientName || fileNameClientName || null;

  const normalizedTypeScores = normalizeScoreMap(profile?.typeScores, TYPE_SCORE_KEYS);
  const normalizedInstinctScores = normalizeScoreMap(profile?.instinctScores, INSTINCT_SCORE_KEYS);
  const normalizedCenterScores = normalizeScoreMap(profile?.centerScores, CENTER_SCORE_KEYS);

  const resolvedPrimaryType = resolvePrimaryTypeFromTypeScores(
    normalizedTypeScores,
    profile?.primaryType || results?.dashboardContext?.detectedType || row?.enneagram_type || null,
  );
  const persistedEnneagramTypeNumber =
    normalizeTypeNumber(resolvedPrimaryType) ?? normalizeTypeNumber(row?.enneagram_type ?? null);
  const persistedEnneagramType =
    persistedEnneagramTypeNumber != null ? String(persistedEnneagramTypeNumber) : null;

  const diagnostics = results?.ingestion?.parseDiagnostics && typeof results.ingestion.parseDiagnostics === "object"
    ? results.ingestion.parseDiagnostics
    : {};

  const nextResults = {
    ...results,
    parsedProfile: {
      ...profile,
      clientName: resolvedClientName,
      primaryType: persistedEnneagramType || profile?.primaryType || null,
      typeScores: normalizedTypeScores,
      instinctScores: normalizedInstinctScores,
      centerScores: normalizedCenterScores,
    },
    dashboardContext: {
      ...(results?.dashboardContext || {}),
      clientName: resolvedClientName,
      detectedType: persistedEnneagramType || results?.dashboardContext?.detectedType || null,
      detectedTypeSource: persistedEnneagramType
        ? "admin-review:bulk-resave"
        : (results?.dashboardContext?.detectedTypeSource || null),
    },
    ingestion: {
      ...(results?.ingestion || {}),
      parseDiagnostics: {
        ...(diagnostics || {}),
        verification: {
          ...(diagnostics?.verification || {}),
          resolvedFields: {
            ...(diagnostics?.verification?.resolvedFields || {}),
            primaryType:
              persistedEnneagramType ||
              diagnostics?.verification?.resolvedFields?.primaryType ||
              null,
          },
        },
      },
    },
    review: {
      ...(results?.review || {}),
      bulkResavedAt: nowIso,
      bulkResavedBy: adminEmail,
    },
  };

  return {
    nextResults,
    persistedEnneagramTypeNumber,
    persistedEnneagramType,
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

export async function POST(req) {
  const admin = await assertAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch (_error) {
    body = {};
  }
  const maxRows = Math.max(1, Math.min(5000, Number(body?.maxRows || 5000)));
  const pageSize = Math.max(1, Math.min(1000, Number(body?.pageSize || 500)));

  const table = process.env.SUPABASE_REPORTS_TABLE || "reports";
  const supabase = getSupabaseAdmin();
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const toIndex = Math.min(offset + pageSize - 1, maxRows - 1);
    const { data, error } = await supabase
      .from(table)
      .select("id,user_email,enneagram_type,results_data,report_pdf")
      .eq("source", "admin-import")
      .order("created_at", { ascending: false })
      .range(offset, toIndex);

    if (error) {
      return NextResponse.json({ error: `Failed to load reports: ${error.message}` }, { status: 500 });
    }

    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    if (pageRows.length < (toIndex - offset + 1)) break;
  }
  const gradedRows = rows.filter((row) => shouldBackfillRow(row));

  let processedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const row of gradedRows) {
    processedCount += 1;
    const normalized = buildBackfilledRow(row, admin.email);
    if (normalized?.skipReason) {
      skippedCount += 1;
      continue;
    }

    const { nextResults, persistedEnneagramTypeNumber, persistedEnneagramType } = normalized;
    const { error: updateErr } = await supabase
      .from(table)
      .update({ results_data: nextResults, enneagram_type: persistedEnneagramTypeNumber })
      .eq("id", row.id);

    if (updateErr) {
      failedCount += 1;
      failures.push({
        reportId: row.id,
        userEmail: row.user_email || null,
        error: updateErr.message,
      });
      continue;
    }

    updatedCount += 1;
    console.log("[admin-review:bulk-resave] Re-saved graded report", {
      reportId: row.id,
      userEmail: row.user_email || null,
      persistedEnneagramType,
    });
  }

  console.log("[admin-review:bulk-resave] Completed graded report re-save", {
    requestedBy: admin.email,
    scannedRows: rows.length,
    gradedRows: gradedRows.length,
    processedCount,
    updatedCount,
    skippedCount,
    failedCount,
  });

  return NextResponse.json(
    {
      success: true,
      scannedCount: rows.length,
      gradedCount: gradedRows.length,
      processedCount,
      updatedCount,
      skippedCount,
      failedCount,
      failures,
    },
    { status: 200 },
  );
}
