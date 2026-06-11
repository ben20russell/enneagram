import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../../lib/adminAccess";
import { applyMlScoreLearningToParsedProfile } from "../../../../lib/mlScoreLearning";
import { extractClientNameFromReportFileName } from "../../../../lib/reportFileNameClientName";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../../../lib/supabaseAdmin";
import { resolvePdfSanitizeFormFieldMode, sanitizePdfForParsing } from "../../../../lib/pdfSanitize.js";

export const runtime = "nodejs";
export const maxDuration = 300;

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

function normalizeOptionalString(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
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

function normalizeTypePointLabel(value) {
  const typeNumber = normalizeTypeNumber(value);
  if (typeNumber == null) return null;
  return `Type ${typeNumber}`;
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

function hasAnyNumericScores(scoreMap, keys) {
  if (!scoreMap || typeof scoreMap !== "object") return false;
  return keys.some((key) => Number.isFinite(Number(scoreMap?.[key])));
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

function mergeSanitizationIntoParsedPayload(parsed, sanitizationDiagnostics) {
  if (!parsed || typeof parsed !== "object") return parsed;
  return {
    ...parsed,
    _parseDiagnostics: {
      ...(parsed?._parseDiagnostics && typeof parsed._parseDiagnostics === "object"
        ? parsed._parseDiagnostics
        : {}),
      sanitization: sanitizationDiagnostics || null,
    },
    parseSanitization: sanitizationDiagnostics || null,
  };
}

function resolveGroundTruthIdentity(results) {
  const identity =
    results?.ml?.feedback?.groundTruthIdentity && typeof results.ml.feedback.groundTruthIdentity === "object"
      ? results.ml.feedback.groundTruthIdentity
      : {};
  return {
    primaryType: normalizeTypeNumber(identity?.primaryType),
    typeName: normalizeOptionalString(identity?.typeName),
    instinctualVariant: normalizeInstinctualVariant(identity?.instinctualVariant),
    subtypeKeyword: normalizeOptionalString(identity?.subtypeKeyword),
    integrationLevel: normalizeIntegrationLevel(identity?.integrationLevel),
    releasePoint: normalizeTypePointLabel(identity?.releasePoint),
    stretchPoint: normalizeTypePointLabel(identity?.stretchPoint),
  };
}

function buildBackfilledRow({
  row,
  adminEmail,
  parsedProfile,
  mlLearning,
  sanitizationDiagnostics,
}) {
  const nowIso = new Date().toISOString();
  const results = normalizeResultsData(row?.results_data);
  const existingProfile = results?.parsedProfile && typeof results.parsedProfile === "object"
    ? results.parsedProfile
    : null;
  const activeProfile = parsedProfile && typeof parsedProfile === "object"
    ? parsedProfile
    : existingProfile;

  if (!activeProfile) {
    return { skipReason: "missing_parsed_profile" };
  }

  const groundTruthIdentity = resolveGroundTruthIdentity(results);
  const fileName = row?.report_pdf?.fileName || results?.file?.fileName || null;
  const fileNameClientName = extractClientNameFromReportFileName(fileName);
  const parsedClientName = normalizeOptionalString(activeProfile?.clientName);
  const existingClientName = normalizeOptionalString(existingProfile?.clientName);
  const resolvedClientName = parsedClientName || existingClientName || fileNameClientName || null;

  const preferredTypeScores = hasAnyNumericScores(existingProfile?.typeScores, TYPE_SCORE_KEYS)
    ? existingProfile?.typeScores
    : activeProfile?.typeScores;
  const preferredInstinctScores = hasAnyNumericScores(existingProfile?.instinctScores, INSTINCT_SCORE_KEYS)
    ? existingProfile?.instinctScores
    : activeProfile?.instinctScores;
  const preferredCenterScores = hasAnyNumericScores(existingProfile?.centerScores, CENTER_SCORE_KEYS)
    ? existingProfile?.centerScores
    : activeProfile?.centerScores;

  const normalizedTypeScores = normalizeScoreMap(preferredTypeScores, TYPE_SCORE_KEYS);
  const normalizedInstinctScores = normalizeScoreMap(preferredInstinctScores, INSTINCT_SCORE_KEYS);
  const normalizedCenterScores = normalizeScoreMap(preferredCenterScores, CENTER_SCORE_KEYS);

  const resolvedPrimaryType = resolvePrimaryTypeFromTypeScores(
    normalizedTypeScores,
    groundTruthIdentity.primaryType ||
      existingProfile?.primaryType ||
      activeProfile?.primaryType ||
      results?.dashboardContext?.detectedType ||
      row?.enneagram_type ||
      null,
  );
  const persistedEnneagramTypeNumber =
    normalizeTypeNumber(resolvedPrimaryType) ?? normalizeTypeNumber(row?.enneagram_type ?? null);
  const persistedEnneagramType =
    persistedEnneagramTypeNumber != null ? String(persistedEnneagramTypeNumber) : null;

  const resolvedTypeName =
    groundTruthIdentity.typeName ||
    normalizeOptionalString(existingProfile?.typeName) ||
    normalizeOptionalString(activeProfile?.typeName) ||
    null;
  const resolvedInstinctualVariant =
    groundTruthIdentity.instinctualVariant ||
    normalizeInstinctualVariant(existingProfile?.instinctualVariant) ||
    normalizeInstinctualVariant(activeProfile?.instinctualVariant) ||
    normalizeInstinctualVariant(results?.dashboardContext?.instinct) ||
    normalizeInstinctualVariant(results?.dashboardContext?.instinctCode) ||
    null;
  const resolvedSubtypeKeyword =
    groundTruthIdentity.subtypeKeyword ||
    normalizeOptionalString(existingProfile?.subtypeKeyword) ||
    normalizeOptionalString(activeProfile?.subtypeKeyword) ||
    null;
  const resolvedIntegrationLevel =
    groundTruthIdentity.integrationLevel ||
    normalizeIntegrationLevel(existingProfile?.integrationLevel) ||
    normalizeIntegrationLevel(activeProfile?.integrationLevel) ||
    normalizeIntegrationLevel(results?.dashboardContext?.integrationLevel) ||
    normalizeIntegrationLevel(results?.dashboardContext?.integration) ||
    null;
  const resolvedReleasePoint =
    groundTruthIdentity.releasePoint ||
    normalizeTypePointLabel(existingProfile?.connectedLineA) ||
    normalizeTypePointLabel(activeProfile?.connectedLineA) ||
    null;
  const resolvedStretchPoint =
    groundTruthIdentity.stretchPoint ||
    normalizeTypePointLabel(existingProfile?.connectedLineB) ||
    normalizeTypePointLabel(activeProfile?.connectedLineB) ||
    null;

  const existingDiagnostics = results?.ingestion?.parseDiagnostics && typeof results.ingestion.parseDiagnostics === "object"
    ? results.ingestion.parseDiagnostics
    : {};
  const pipelineDiagnostics = activeProfile?._parseDiagnostics && typeof activeProfile._parseDiagnostics === "object"
    ? activeProfile._parseDiagnostics
    : {};
  const parseSanitization =
    activeProfile?.parseSanitization ||
    activeProfile?._parseDiagnostics?.sanitization ||
    sanitizationDiagnostics ||
    existingDiagnostics?.sanitization ||
    null;

  const nextDiagnostics = {
    ...(existingDiagnostics || {}),
    ...(pipelineDiagnostics || {}),
    sanitization: parseSanitization,
    verification: {
      ...(existingDiagnostics?.verification || {}),
      ...(pipelineDiagnostics?.verification || {}),
      resolvedFields: {
        ...(existingDiagnostics?.verification?.resolvedFields || {}),
        ...(pipelineDiagnostics?.verification?.resolvedFields || {}),
        primaryType:
          persistedEnneagramType ||
          pipelineDiagnostics?.verification?.resolvedFields?.primaryType ||
          existingDiagnostics?.verification?.resolvedFields?.primaryType ||
          null,
        instinctualVariant:
          resolvedInstinctualVariant ||
          pipelineDiagnostics?.verification?.resolvedFields?.instinctualVariant ||
          existingDiagnostics?.verification?.resolvedFields?.instinctualVariant ||
          null,
        integrationLevel:
          resolvedIntegrationLevel ||
          pipelineDiagnostics?.verification?.resolvedFields?.integrationLevel ||
          existingDiagnostics?.verification?.resolvedFields?.integrationLevel ||
          null,
      },
    },
  };

  const parseState = String(
    activeProfile?._parseStatus ||
      activeProfile?._parseState ||
      activeProfile?._parseDiagnostics?.parseState ||
      "",
  ).toLowerCase();
  const isParseComplete = parseState === "complete";

  const nextParsedProfile = {
    ...activeProfile,
    clientName: resolvedClientName,
    primaryType: persistedEnneagramType || normalizeOptionalString(activeProfile?.primaryType) || null,
    typeName: resolvedTypeName,
    instinctualVariant: resolvedInstinctualVariant,
    subtypeKeyword: resolvedSubtypeKeyword,
    integrationLevel: resolvedIntegrationLevel,
    connectedLineA: resolvedReleasePoint,
    connectedLineB: resolvedStretchPoint,
    typeScores: normalizedTypeScores,
    instinctScores: normalizedInstinctScores,
    centerScores: normalizedCenterScores,
    parseSanitization: parseSanitization,
    _parseDiagnostics: nextDiagnostics,
  };

  const existingExtractedContent = results?.extractedContent && typeof results.extractedContent === "object"
    ? results.extractedContent
    : {};
  const reportContent = activeProfile?.reportContent && typeof activeProfile.reportContent === "object"
    ? activeProfile.reportContent
    : null;
  const nextExtractedContent = {
    ...(existingExtractedContent || {}),
    documentSummary: reportContent?.documentSummary || existingExtractedContent?.documentSummary || null,
    pages: Array.isArray(reportContent?.pages)
      ? reportContent.pages
      : (Array.isArray(existingExtractedContent?.pages) ? existingExtractedContent.pages : []),
    sections: Array.isArray(reportContent?.sections)
      ? reportContent.sections
      : (Array.isArray(existingExtractedContent?.sections) ? existingExtractedContent.sections : []),
    extractedAt: nowIso,
    parserVersion: nextDiagnostics?.parserVersion || existingExtractedContent?.parserVersion || "multi-pass-v3",
  };

  const existingIngestion = results?.ingestion && typeof results.ingestion === "object"
    ? results.ingestion
    : {};

  const nextResults = {
    ...results,
    parsedProfile: nextParsedProfile,
    dashboardContext: {
      ...(results?.dashboardContext || {}),
      clientName: resolvedClientName,
      detectedType: persistedEnneagramType || results?.dashboardContext?.detectedType || null,
      detectedTypeSource: persistedEnneagramType
        ? "admin-review:bulk-resave"
        : (results?.dashboardContext?.detectedTypeSource || null),
      sourceFileName: fileName || results?.dashboardContext?.sourceFileName || null,
      basicFear: normalizeOptionalString(activeProfile?.coreFear) || results?.dashboardContext?.basicFear || null,
      basicDesire: normalizeOptionalString(activeProfile?.coreDesire) || results?.dashboardContext?.basicDesire || null,
      passion: normalizeOptionalString(activeProfile?.passion) || results?.dashboardContext?.passion || null,
      instinct: resolvedInstinctualVariant || results?.dashboardContext?.instinct || null,
      instinctCode: resolvedInstinctualVariant || results?.dashboardContext?.instinctCode || null,
      integrationLevel: resolvedIntegrationLevel || results?.dashboardContext?.integrationLevel || null,
      integration: resolvedIntegrationLevel || results?.dashboardContext?.integration || null,
    },
    extractedContent: nextExtractedContent,
    ingestion: {
      ...(existingIngestion || {}),
      status: isParseComplete
        ? "ready"
        : (existingIngestion?.status || "incomplete"),
      parseDiagnostics: nextDiagnostics,
      ml: mlLearning && typeof mlLearning === "object"
        ? mlLearning
        : (existingIngestion?.ml || null),
      reparsePipeline: {
        source: "admin-review:bulk-resave",
        ranAt: nowIso,
        parseState: parseState || null,
        formFieldMode: parseSanitization?.formFieldMode || null,
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
    parseState: parseState || "unknown",
  };
}

async function runSanitizeAndParsePipeline({ row, table, supabase, parsePdf }) {
  const results = normalizeResultsData(row?.results_data);
  const bucket = normalizeOptionalString(
    row?.report_pdf?.bucket || results?.file?.bucket || getSupabaseStorageBucket(),
  );
  const storagePath = normalizeOptionalString(
    row?.report_pdf?.storagePath || results?.file?.storagePath || null,
  );

  if (!bucket) {
    throw new Error("Report is missing storage bucket metadata");
  }
  if (!storagePath) {
    throw new Error("Report has no stored PDF path");
  }

  const { data: fileBlob, error: downloadErr } = await supabase.storage.from(bucket).download(storagePath);
  if (downloadErr || !fileBlob) {
    throw new Error(`Failed to download report PDF: ${downloadErr?.message || "unknown error"}`);
  }

  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());
  const sanitizedPdf = await sanitizePdfForParsing(pdfBuffer, {
    source: "/api/admin-review/resave-graded",
    formFieldMode: resolvePdfSanitizeFormFieldMode(process.env.PDF_SANITIZE_FORM_FIELDS_MODE),
    removeAnnotations: true,
    stripNonContentExtras: true,
    stripMetadata: true,
  });

  const parsed = await parsePdf(sanitizedPdf.buffer, {
    disableImagePipeline: true,
    disableImageScoreRescue: true,
    allowLocalTextFallback: true,
    enablePythonCrossCheck: true,
  });
  const parsedWithSanitization = mergeSanitizationIntoParsedPayload(
    parsed,
    sanitizedPdf?.diagnostics || null,
  );

  const mlLearningResult = await applyMlScoreLearningToParsedProfile({
    supabase,
    table,
    parsedProfile: parsedWithSanitization,
    reportId: row.id,
  });

  const parsedForSaveRaw =
    mlLearningResult?.parsedProfile && typeof mlLearningResult.parsedProfile === "object"
      ? mlLearningResult.parsedProfile
      : parsedWithSanitization;
  const parsedForSave = mergeSanitizationIntoParsedPayload(
    parsedForSaveRaw,
    sanitizedPdf?.diagnostics || null,
  );
  const mlLearning = mlLearningResult?.ml && typeof mlLearningResult.ml === "object"
    ? mlLearningResult.ml
    : null;

  return {
    parsedForSave,
    mlLearning,
    sanitizationDiagnostics: sanitizedPdf?.diagnostics || null,
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
  const { parsePdf } = await import("../../../../lib/parsePdf.js");

  let processedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const row of gradedRows) {
    processedCount += 1;

    try {
      const pipeline = await runSanitizeAndParsePipeline({
        row,
        table,
        supabase,
        parsePdf,
      });
      const normalized = buildBackfilledRow({
        row,
        adminEmail: admin.email,
        parsedProfile: pipeline.parsedForSave,
        mlLearning: pipeline.mlLearning,
        sanitizationDiagnostics: pipeline.sanitizationDiagnostics,
      });
      if (normalized?.skipReason) {
        skippedCount += 1;
        continue;
      }

      const { nextResults, persistedEnneagramTypeNumber, persistedEnneagramType, parseState } = normalized;
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
        parseState,
      });
    } catch (error) {
      failedCount += 1;
      failures.push({
        reportId: row.id,
        userEmail: row.user_email || null,
        error: String(error?.message || error),
      });
      continue;
    }
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
