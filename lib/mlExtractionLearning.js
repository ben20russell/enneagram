const TRAINING_APPROVED_STATUSES = new Set(["approved", "auto_approved"]);

export const ML_EXTRACTION_MODEL_VERSION = "identity-priors-v1";

function normalizeOptionalObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeTypeNumber(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const floored = Math.floor(numeric);
    if (floored >= 1 && floored <= 9) return floored;
  }
  const matched = String(value).match(/[1-9]/);
  return matched?.[0] ? Number(matched[0]) : null;
}

function normalizeInstinctualVariant(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "sx" ||
    normalized.includes("sexual") ||
    normalized.includes("one-on-one") ||
    normalized.includes("one on one")
  ) {
    return "sx";
  }
  if (normalized === "so" || normalized.includes("social")) return "so";
  if (
    normalized === "sp" ||
    normalized.includes("self-preservation") ||
    normalized.includes("self preservation")
  ) {
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

function normalizeTypeName(value) {
  return normalizeOptionalString(value);
}

function toPercentage(value, denominator) {
  const numerator = Number(value);
  const total = Number(denominator);
  if (!Number.isFinite(numerator) || !Number.isFinite(total) || total <= 0) return 0;
  return Number(((numerator / total) * 100).toFixed(1));
}

function buildEmptyTrainingDiagnostics(scannedRowCount = 0) {
  return {
    scannedRowCount: Number.isFinite(Number(scannedRowCount)) ? Number(scannedRowCount) : 0,
    skippedExcludedCount: 0,
    skippedUnapprovedCount: 0,
    skippedUnlabeledCount: 0,
    approvedSampleCount: 0,
    groundTruthSampleCount: 0,
    trainingSampleCount: 0,
  };
}

function buildSkippedContext({
  reason,
  training,
  details = null,
}) {
  return {
    modelVersion: ML_EXTRACTION_MODEL_VERSION,
    status: "skipped",
    reason: normalizeOptionalString(reason) || "not_available",
    details: normalizeOptionalString(details),
    generatedAt: new Date().toISOString(),
    training: training || buildEmptyTrainingDiagnostics(0),
    priors: {
      topTypes: [],
      topInstincts: [],
      topIntegrationLevels: [],
    },
    hintCount: 0,
    promptHintText: "",
  };
}

function readResultsObject(row) {
  if (!row || typeof row !== "object") return {};
  const resultsData = row?.results_data;
  if (!resultsData || typeof resultsData !== "object" || Array.isArray(resultsData)) return {};
  return resultsData;
}

function readReviewStatus(results) {
  return String(results?.review?.status ?? "").trim().toLowerCase();
}

function readGroundTruthIdentity(results) {
  const feedback = normalizeOptionalObject(results?.ml?.feedback);
  const raw = normalizeOptionalObject(feedback?.groundTruthIdentity);
  const hasAnyField = Boolean(
    raw?.primaryType != null ||
      raw?.typeName != null ||
      raw?.instinctualVariant != null ||
      raw?.integrationLevel != null,
  );
  return hasAnyField ? raw : null;
}

function resolveIdentityFromResults(results, groundTruthIdentity = null) {
  const parsedProfile = normalizeOptionalObject(results?.parsedProfile);
  const dashboardContext = normalizeOptionalObject(results?.dashboardContext);
  const groundTruth = normalizeOptionalObject(groundTruthIdentity);

  const primaryType = normalizeTypeNumber(
    groundTruth?.primaryType ??
      parsedProfile?.primaryType ??
      parsedProfile?.typeNumber ??
      parsedProfile?.type_number ??
      dashboardContext?.detectedType,
  );
  const typeName = normalizeTypeName(
    groundTruth?.typeName ??
      parsedProfile?.typeName ??
      parsedProfile?.core_type_name ??
      parsedProfile?.typeTitle ??
      dashboardContext?.typeName,
  );
  const instinctualVariant = normalizeInstinctualVariant(
    groundTruth?.instinctualVariant ??
      parsedProfile?.instinctualVariant ??
      dashboardContext?.instinctCode ??
      dashboardContext?.instinct,
  );
  const integrationLevel = normalizeIntegrationLevel(
    groundTruth?.integrationLevel ??
      parsedProfile?.integrationLevel ??
      dashboardContext?.integrationLevel ??
      dashboardContext?.integration,
  );

  return {
    primaryType,
    typeName,
    instinctualVariant,
    integrationLevel,
  };
}

function computeTypePriors(samples) {
  const total = samples.length;
  const typeCounts = new Map();
  const typeNameCounts = new Map();

  samples.forEach((sample) => {
    const typeNumber = normalizeTypeNumber(sample?.primaryType);
    if (typeNumber == null) return;
    const typeKey = String(typeNumber);
    typeCounts.set(typeKey, (typeCounts.get(typeKey) || 0) + 1);

    const typeName = normalizeTypeName(sample?.typeName);
    if (!typeName) return;
    const bucket = typeNameCounts.get(typeKey) || new Map();
    bucket.set(typeName, (bucket.get(typeName) || 0) + 1);
    typeNameCounts.set(typeKey, bucket);
  });

  return Array.from(typeCounts.entries())
    .map(([typeNumber, count]) => {
      const namesBucket = typeNameCounts.get(typeNumber) || new Map();
      const commonTypeNames = Array.from(namesBucket.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([name]) => name);
      return {
        typeNumber: Number(typeNumber),
        count,
        share: toPercentage(count, total),
        commonTypeNames,
      };
    })
    .sort((a, b) => b.count - a.count || a.typeNumber - b.typeNumber);
}

function computeValuePriors(samples, valueReader, valueKeyName) {
  const total = samples.length;
  const counts = new Map();

  samples.forEach((sample) => {
    const value = normalizeOptionalString(valueReader(sample));
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([value, count]) => ({
      [valueKeyName]: value,
      count,
      share: toPercentage(count, total),
    }))
    .sort((a, b) => b.count - a.count || String(a[valueKeyName]).localeCompare(String(b[valueKeyName])));
}

function buildPromptHints({
  topTypes,
  topInstincts,
  topIntegrationLevels,
  maxHints = 6,
}) {
  const hints = [];
  const normalizedMaxHints = Math.max(1, Math.floor(Number(maxHints) || 6));
  const strongestType = topTypes[0];
  const strongestInstinct = topInstincts[0];
  const strongestIntegration = topIntegrationLevels[0];

  if (strongestType) {
    hints.push(
      `Top reviewed prior: Type ${strongestType.typeNumber} appears in ${strongestType.share}% of reviewed reports.`,
    );
  }
  if (strongestInstinct) {
    hints.push(
      `Dominant instinct prior: ${String(strongestInstinct.instinctualVariant || "").toUpperCase()} appears in ${strongestInstinct.share}% of reviewed reports.`,
    );
  }
  if (strongestIntegration) {
    hints.push(
      `Integration-level prior: ${strongestIntegration.integrationLevel} appears in ${strongestIntegration.share}% of reviewed reports.`,
    );
  }

  topTypes.slice(0, 3).forEach((entry) => {
    if (!Array.isArray(entry?.commonTypeNames) || entry.commonTypeNames.length === 0) return;
    hints.push(`Observed Type ${entry.typeNumber} naming: ${entry.commonTypeNames.join("; ")}.`);
  });

  return hints.slice(0, normalizedMaxHints).filter(Boolean);
}

export function buildMlExtractionLearningContextFromReportRows(rows, options = {}) {
  const reportRows = Array.isArray(rows) ? rows : [];
  const excludeReportId = normalizeOptionalString(options?.excludeReportId);
  const minTrainingExamples = Math.max(1, Math.floor(Number(options?.minTrainingExamples) || 3));
  const maxHints = Math.max(1, Math.floor(Number(options?.maxHints) || 6));
  const diagnostics = buildEmptyTrainingDiagnostics(reportRows.length);
  const samples = [];

  reportRows.forEach((row) => {
    const rowReportId = normalizeOptionalString(row?.id);
    if (!rowReportId || (excludeReportId && rowReportId === excludeReportId)) {
      diagnostics.skippedExcludedCount += 1;
      return;
    }

    const results = readResultsObject(row);
    const reviewStatus = readReviewStatus(results);
    const groundTruthIdentity = readGroundTruthIdentity(results);
    const isApproved = TRAINING_APPROVED_STATUSES.has(reviewStatus) || Boolean(groundTruthIdentity);
    if (!isApproved) {
      diagnostics.skippedUnapprovedCount += 1;
      return;
    }
    if (TRAINING_APPROVED_STATUSES.has(reviewStatus)) {
      diagnostics.approvedSampleCount += 1;
    }

    const identity = resolveIdentityFromResults(results, groundTruthIdentity);
    const hasIdentitySignal = Boolean(
      identity.primaryType != null ||
        identity.typeName != null ||
        identity.instinctualVariant != null ||
        identity.integrationLevel != null,
    );
    if (!hasIdentitySignal) {
      diagnostics.skippedUnlabeledCount += 1;
      return;
    }

    if (groundTruthIdentity) {
      diagnostics.groundTruthSampleCount += 1;
    }

    samples.push({
      reportId: rowReportId,
      reviewStatus,
      labelSource: groundTruthIdentity ? "admin-review-ground-truth" : "approved-profile",
      ...identity,
    });
  });

  diagnostics.trainingSampleCount = samples.length;

  if (samples.length < minTrainingExamples) {
    return buildSkippedContext({
      reason: "insufficient_training_examples",
      training: diagnostics,
    });
  }

  const topTypes = computeTypePriors(samples);
  const topInstincts = computeValuePriors(
    samples,
    (sample) => sample?.instinctualVariant,
    "instinctualVariant",
  );
  const topIntegrationLevels = computeValuePriors(
    samples,
    (sample) => sample?.integrationLevel,
    "integrationLevel",
  );
  // These are soft priors only; the extraction prompt still treats report evidence as authoritative.
  const hintLines = buildPromptHints({
    topTypes,
    topInstincts,
    topIntegrationLevels,
    maxHints,
  });

  return {
    modelVersion: ML_EXTRACTION_MODEL_VERSION,
    status: "active",
    reason: null,
    details: null,
    generatedAt: new Date().toISOString(),
    training: diagnostics,
    priors: {
      topTypes,
      topInstincts,
      topIntegrationLevels,
    },
    hintCount: hintLines.length,
    promptHintText: hintLines.join("\n"),
  };
}

export async function buildMlExtractionLearningContext({
  supabase,
  table,
  reportId,
  maxRows = 300,
  minTrainingExamples = 3,
  maxHints = 6,
} = {}) {
  if (!supabase || typeof supabase.from !== "function") {
    return buildSkippedContext({
      reason: "missing_supabase_client",
      training: buildEmptyTrainingDiagnostics(0),
    });
  }

  const reportsTable = normalizeOptionalString(table);
  if (!reportsTable) {
    return buildSkippedContext({
      reason: "missing_reports_table",
      training: buildEmptyTrainingDiagnostics(0),
    });
  }

  const queryLimit = Math.max(25, Math.floor(Number(maxRows) || 300));
  let rows = [];
  try {
    const { data, error } = await supabase
      .from(reportsTable)
      .select("id,created_at,results_data")
      .order("created_at", { ascending: false })
      .limit(queryLimit);

    if (error) {
      return buildSkippedContext({
        reason: "training_query_failed",
        details: error.message,
        training: buildEmptyTrainingDiagnostics(0),
      });
    }
    rows = Array.isArray(data) ? data : [];
  } catch (error) {
    return buildSkippedContext({
      reason: "training_query_exception",
      details: String(error?.message || error),
      training: buildEmptyTrainingDiagnostics(0),
    });
  }

  return buildMlExtractionLearningContextFromReportRows(rows, {
    excludeReportId: reportId,
    minTrainingExamples,
    maxHints,
  });
}
