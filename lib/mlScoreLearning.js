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
const TRAINING_APPROVED_STATUSES = new Set(["approved", "auto_approved"]);
const DEFAULT_STRAIN_KEYS = [
  "happiness",
  "vocational",
  "interpersonal",
  "physical",
  "environmental",
  "psychological",
];

export const ML_SCORE_MODEL_VERSION = "knn-score-v1";

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toScore(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = toFiniteNumber(value);
  if (numeric == null) return null;
  const rounded = Math.round(numeric);
  if (rounded < 0 || rounded > 100) return null;
  return rounded;
}

function normalizeOptionalObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeScoreGroup(rawScores, keys) {
  const normalized = {};
  keys.forEach((key) => {
    normalized[key] = toScore(rawScores?.[key]);
  });
  return normalized;
}

export function normalizeScorePayload(raw) {
  const input = normalizeOptionalObject(raw);
  return {
    typeScores: normalizeScoreGroup(input.typeScores, TYPE_SCORE_KEYS),
    instinctScores: normalizeScoreGroup(input.instinctScores, INSTINCT_SCORE_KEYS),
    centerScores: normalizeScoreGroup(input.centerScores, CENTER_SCORE_KEYS),
  };
}

function countNonNullScores(scoreGroup) {
  if (!scoreGroup || typeof scoreGroup !== "object") return 0;
  return Object.values(scoreGroup).filter((value) => value != null).length;
}

function normalizeType(value) {
  const numeric = toFiniteNumber(value);
  if (numeric != null) {
    const floored = Math.floor(numeric);
    if (floored >= 1 && floored <= 9) return floored;
  }
  const matched = String(value ?? "").match(/[1-9]/);
  return matched?.[0] ? Number(matched[0]) : null;
}

function normalizeInstinct(value) {
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

function normalizeIntegration(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "high") return "high";
  if (normalized === "moderate" || normalized === "medium") return "moderate";
  if (normalized === "low") return "low";
  return normalized;
}

function normalizeSubtypeKeyword(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return normalized.replace(/\s+/g, " ");
}

function normalizeStrainLevel(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("high")) return 2;
  if (normalized.startsWith("moderate") || normalized.startsWith("medium")) return 1;
  if (normalized.startsWith("low")) return 0;
  return null;
}

function getStrainLevelSource(parsedProfile) {
  const profile = normalizeOptionalObject(parsedProfile);
  const strainLevels = normalizeOptionalObject(profile?.strainLevels);
  const legacyLevels = normalizeOptionalObject(profile?.strain_levels);
  return { strainLevels, legacyLevels };
}

function normalizeGroundTruthIdentity(results) {
  const feedback = normalizeOptionalObject(results?.ml?.feedback);
  const raw = normalizeOptionalObject(feedback?.groundTruthIdentity);
  const hasAnyField = Boolean(
    raw?.primaryType != null ||
      raw?.instinctualVariant != null ||
      raw?.integrationLevel != null ||
      raw?.subtypeKeyword != null ||
      raw?.stretchPoint != null ||
      raw?.releasePoint != null,
  );
  if (!hasAnyField) return null;
  return raw;
}

function buildMlFeatures(parsedProfile, identityOverride = null) {
  const profile = normalizeOptionalObject(parsedProfile);
  const override = normalizeOptionalObject(identityOverride);
  const { strainLevels, legacyLevels } = getStrainLevelSource(profile);

  const normalizedStrain = {};
  DEFAULT_STRAIN_KEYS.forEach((key) => {
    const modernValue = strainLevels?.[key];
    const legacyValue = legacyLevels?.[`${key}_strain`];
    normalizedStrain[key] = normalizeStrainLevel(modernValue ?? legacyValue ?? null);
  });

  return {
    primaryType: normalizeType(override?.primaryType ?? profile?.primaryType ?? profile?.typeNumber ?? profile?.type_number),
    instinctualVariant: normalizeInstinct(override?.instinctualVariant ?? profile?.instinctualVariant),
    integrationLevel: normalizeIntegration(override?.integrationLevel ?? profile?.integrationLevel),
    subtypeKeyword: normalizeSubtypeKeyword(override?.subtypeKeyword ?? profile?.subtypeKeyword),
    releasePointType: normalizeType(override?.releasePoint ?? profile?.connectedLineA),
    stretchPointType: normalizeType(override?.stretchPoint ?? profile?.connectedLineB),
    strainLevels: normalizedStrain,
  };
}

function hasAnyLabeledScore(normalizedScores) {
  return (
    countNonNullScores(normalizedScores?.typeScores) > 0 ||
    countNonNullScores(normalizedScores?.instinctScores) > 0 ||
    countNonNullScores(normalizedScores?.centerScores) > 0
  );
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

function readGroundTruthScores(results) {
  const feedback = normalizeOptionalObject(results?.ml?.feedback);
  const raw = feedback?.groundTruthScores;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const normalized = normalizeScorePayload(raw);
  return hasAnyLabeledScore(normalized) ? normalized : null;
}

export function buildMlTrainingExamplesFromReportRows(rows, options = {}) {
  const reportRows = Array.isArray(rows) ? rows : [];
  const excludeReportId = String(options?.excludeReportId ?? "").trim();
  const examples = [];
  const diagnostics = {
    scannedRowCount: reportRows.length,
    skippedExcludedCount: 0,
    skippedUnlabeledCount: 0,
    skippedUnapprovedCount: 0,
    trainingSampleCount: 0,
    groundTruthSampleCount: 0,
    approvedSampleCount: 0,
  };

  reportRows.forEach((row) => {
    const rowReportId = String(row?.id ?? "").trim();
    if (!rowReportId || (excludeReportId && rowReportId === excludeReportId)) {
      diagnostics.skippedExcludedCount += 1;
      return;
    }

    const results = readResultsObject(row);
    const parsedProfile = normalizeOptionalObject(results?.parsedProfile);
    const groundTruthIdentity = normalizeGroundTruthIdentity(results);
    const reviewStatus = readReviewStatus(results);
    const groundTruthScores = readGroundTruthScores(results);
    const fallbackScores = normalizeScorePayload(parsedProfile);
    const labelScores = groundTruthScores || fallbackScores;
    if (!hasAnyLabeledScore(labelScores)) {
      diagnostics.skippedUnlabeledCount += 1;
      return;
    }

    const isApprovedByReview = TRAINING_APPROVED_STATUSES.has(reviewStatus);
    if (!groundTruthScores && !isApprovedByReview) {
      diagnostics.skippedUnapprovedCount += 1;
      return;
    }

    const features = buildMlFeatures(parsedProfile, groundTruthIdentity);
    examples.push({
      reportId: rowReportId,
      createdAt: String(row?.created_at ?? "").trim() || null,
      features,
      labels: labelScores,
      labelSource: groundTruthScores ? "admin-review-ground-truth" : "approved-profile",
      reviewStatus,
    });
    if (groundTruthScores) diagnostics.groundTruthSampleCount += 1;
    if (isApprovedByReview) diagnostics.approvedSampleCount += 1;
  });

  diagnostics.trainingSampleCount = examples.length;
  return { examples, diagnostics };
}

function categoricalDistance(a, b, { missingPenalty = 0.5, mismatchPenalty = 1 } = {}) {
  if (a == null || b == null) return missingPenalty;
  return a === b ? 0 : mismatchPenalty;
}

function numericDistance(a, b, { missingPenalty = 0.15, scale = 2 } = {}) {
  if (a == null || b == null) return missingPenalty;
  const normalizedScale = Math.max(1, Number(scale) || 1);
  return Math.abs(a - b) / normalizedScale;
}

function computeExampleDistance(targetFeatures, exampleFeatures) {
  let distance = 0;
  distance += categoricalDistance(targetFeatures?.primaryType, exampleFeatures?.primaryType, {
    missingPenalty: 1.2,
    mismatchPenalty: 2.6,
  });
  distance += categoricalDistance(targetFeatures?.instinctualVariant, exampleFeatures?.instinctualVariant, {
    missingPenalty: 0.7,
    mismatchPenalty: 1.4,
  });
  distance += categoricalDistance(targetFeatures?.integrationLevel, exampleFeatures?.integrationLevel, {
    missingPenalty: 0.45,
    mismatchPenalty: 0.95,
  });
  distance += categoricalDistance(targetFeatures?.subtypeKeyword, exampleFeatures?.subtypeKeyword, {
    missingPenalty: 0.25,
    mismatchPenalty: 0.6,
  });
  distance += categoricalDistance(targetFeatures?.releasePointType, exampleFeatures?.releasePointType, {
    missingPenalty: 0.3,
    mismatchPenalty: 0.8,
  });
  distance += categoricalDistance(targetFeatures?.stretchPointType, exampleFeatures?.stretchPointType, {
    missingPenalty: 0.3,
    mismatchPenalty: 0.8,
  });

  DEFAULT_STRAIN_KEYS.forEach((key) => {
    distance += numericDistance(
      targetFeatures?.strainLevels?.[key],
      exampleFeatures?.strainLevels?.[key],
      { missingPenalty: 0.1, scale: 2 },
    );
  });
  return distance;
}

function roundTo(value, digits = 3) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return null;
  const factor = 10 ** Math.max(0, Math.floor(digits));
  return Math.round(numeric * factor) / factor;
}

function buildFieldPrediction(neighbors, groupName, key, minNeighborsPerField) {
  const usable = neighbors
    .map((neighbor) => ({
      value: toScore(neighbor?.labels?.[groupName]?.[key]),
      weight: toFiniteNumber(neighbor?.weight),
      distance: toFiniteNumber(neighbor?.distance),
    }))
    .filter((entry) => entry.value != null && entry.weight != null && entry.weight > 0);

  const neighborCount = usable.length;
  if (!neighborCount) {
    return {
      value: null,
      confidence: 0,
      neighborCount: 0,
      standardDeviation: null,
      weightedMean: null,
    };
  }

  const weightSum = usable.reduce((total, entry) => total + entry.weight, 0);
  if (weightSum <= 0) {
    return {
      value: null,
      confidence: 0,
      neighborCount: neighborCount,
      standardDeviation: null,
      weightedMean: null,
    };
  }

  const weightedMean = usable.reduce((total, entry) => total + entry.value * entry.weight, 0) / weightSum;
  const variance = usable.reduce((total, entry) => {
    const delta = entry.value - weightedMean;
    return total + (delta * delta * entry.weight);
  }, 0) / weightSum;
  const standardDeviation = Math.sqrt(Math.max(0, variance));
  const normalizedSupport = Math.min(1, neighborCount / Math.max(1, minNeighborsPerField + 1));
  const normalizedConsistency = Math.max(0, 1 - Math.min(1, standardDeviation / 35));
  const confidence = roundTo(normalizedSupport * 0.55 + normalizedConsistency * 0.45, 4);

  return {
    value: toScore(weightedMean),
    confidence: confidence ?? 0,
    neighborCount,
    standardDeviation: roundTo(standardDeviation, 4),
    weightedMean: roundTo(weightedMean, 4),
  };
}

function groupAverageConfidence(fieldDiagnostics, keys) {
  const usable = keys
    .map((key) => toFiniteNumber(fieldDiagnostics?.[key]?.confidence))
    .filter((value) => value != null);
  if (!usable.length) return 0;
  const total = usable.reduce((sum, value) => sum + value, 0);
  return roundTo(total / usable.length, 4) || 0;
}

function countPredictedFields(prediction, keys) {
  return keys.filter((key) => prediction?.[key] != null).length;
}

export function predictMlScoresFromExamples({
  examples,
  parsedProfile,
  topK = 8,
  minNeighborsPerField = 2,
} = {}) {
  const candidateExamples = Array.isArray(examples) ? examples : [];
  const normalizedTopK = Math.max(1, Math.floor(Number(topK) || 1));
  const normalizedMinNeighborsPerField = Math.max(1, Math.floor(Number(minNeighborsPerField) || 1));
  const targetFeatures = buildMlFeatures(parsedProfile);

  if (!candidateExamples.length) {
    return {
      modelVersion: ML_SCORE_MODEL_VERSION,
      eligible: false,
      reason: "no_training_examples",
      trainingSampleCount: 0,
      candidateNeighborCount: 0,
      usedNeighborCount: 0,
      topNeighbors: [],
      prediction: normalizeScorePayload({}),
      fieldDiagnostics: {
        typeScores: {},
        instinctScores: {},
        centerScores: {},
      },
      overallConfidence: 0,
    };
  }

  const rankedNeighbors = candidateExamples
    .map((example) => {
      const distance = computeExampleDistance(targetFeatures, example?.features);
      const weight = 1 / (1 + Math.max(0, distance));
      return {
        ...example,
        distance: roundTo(distance, 6),
        weight: roundTo(weight, 6),
      };
    })
    .sort((a, b) => {
      const distanceDiff = Number(a.distance ?? Infinity) - Number(b.distance ?? Infinity);
      if (distanceDiff !== 0) return distanceDiff;
      return String(a.reportId || "").localeCompare(String(b.reportId || ""));
    });
  const neighbors = rankedNeighbors.slice(0, normalizedTopK);

  const typeFieldDiagnostics = {};
  const instinctFieldDiagnostics = {};
  const centerFieldDiagnostics = {};
  const predictedTypeScores = {};
  const predictedInstinctScores = {};
  const predictedCenterScores = {};

  TYPE_SCORE_KEYS.forEach((key) => {
    const details = buildFieldPrediction(neighbors, "typeScores", key, normalizedMinNeighborsPerField);
    typeFieldDiagnostics[key] = details;
    predictedTypeScores[key] = details.value;
  });
  INSTINCT_SCORE_KEYS.forEach((key) => {
    const details = buildFieldPrediction(neighbors, "instinctScores", key, normalizedMinNeighborsPerField);
    instinctFieldDiagnostics[key] = details;
    predictedInstinctScores[key] = details.value;
  });
  CENTER_SCORE_KEYS.forEach((key) => {
    const details = buildFieldPrediction(neighbors, "centerScores", key, normalizedMinNeighborsPerField);
    centerFieldDiagnostics[key] = details;
    predictedCenterScores[key] = details.value;
  });

  const groupConfidence = {
    typeScores: groupAverageConfidence(typeFieldDiagnostics, TYPE_SCORE_KEYS),
    instinctScores: groupAverageConfidence(instinctFieldDiagnostics, INSTINCT_SCORE_KEYS),
    centerScores: groupAverageConfidence(centerFieldDiagnostics, CENTER_SCORE_KEYS),
  };
  const overallConfidence = roundTo(
    (groupConfidence.typeScores + groupConfidence.instinctScores + groupConfidence.centerScores) / 3,
    4,
  ) || 0;
  const predictedFieldCount =
    countPredictedFields(predictedTypeScores, TYPE_SCORE_KEYS) +
    countPredictedFields(predictedInstinctScores, INSTINCT_SCORE_KEYS) +
    countPredictedFields(predictedCenterScores, CENTER_SCORE_KEYS);

  return {
    modelVersion: ML_SCORE_MODEL_VERSION,
    eligible: predictedFieldCount > 0,
    reason: predictedFieldCount > 0 ? null : "no_predictable_fields",
    trainingSampleCount: candidateExamples.length,
    candidateNeighborCount: rankedNeighbors.length,
    usedNeighborCount: neighbors.length,
    topNeighbors: neighbors.slice(0, 5).map((neighbor) => ({
      reportId: neighbor.reportId,
      labelSource: neighbor.labelSource,
      distance: neighbor.distance,
      weight: neighbor.weight,
      reviewStatus: neighbor.reviewStatus,
    })),
    prediction: {
      typeScores: predictedTypeScores,
      instinctScores: predictedInstinctScores,
      centerScores: predictedCenterScores,
    },
    fieldDiagnostics: {
      typeScores: typeFieldDiagnostics,
      instinctScores: instinctFieldDiagnostics,
      centerScores: centerFieldDiagnostics,
    },
    groupConfidence,
    overallConfidence,
  };
}

function applyGroupPredictions({
  existingGroup,
  predictedGroup,
  fieldDiagnostics,
  keys,
  minConfidence,
  minNeighborCount,
}) {
  const merged = {};
  const applied = {};
  let appliedCount = 0;

  keys.forEach((key) => {
    const currentValue = toScore(existingGroup?.[key]);
    const predictedValue = toScore(predictedGroup?.[key]);
    const confidence = toFiniteNumber(fieldDiagnostics?.[key]?.confidence) ?? 0;
    const neighborCount = Math.floor(toFiniteNumber(fieldDiagnostics?.[key]?.neighborCount) ?? 0);

    let nextValue = currentValue;
    if (
      currentValue == null &&
      predictedValue != null &&
      confidence >= minConfidence &&
      neighborCount >= minNeighborCount
    ) {
      nextValue = predictedValue;
      applied[key] = {
        value: predictedValue,
        confidence: roundTo(confidence, 4),
        neighborCount,
      };
      appliedCount += 1;
    }
    merged[key] = nextValue;
  });

  return { merged, applied, appliedCount };
}

export function applyMlPredictionsToParsedProfile({
  parsedProfile,
  mlPrediction,
  minConfidence = 0.62,
  minNeighborCount = 2,
} = {}) {
  const normalizedProfile = normalizeOptionalObject(parsedProfile);
  const normalizedPrediction = normalizeOptionalObject(mlPrediction);
  const predictionScores = normalizeScorePayload(normalizedPrediction?.prediction || {});
  const existingScores = normalizeScorePayload(normalizedProfile);
  const fieldDiagnostics = normalizeOptionalObject(normalizedPrediction?.fieldDiagnostics);
  const normalizedMinConfidence = Math.max(0, Math.min(1, Number(minConfidence) || 0));
  const normalizedMinNeighborCount = Math.max(1, Math.floor(Number(minNeighborCount) || 1));

  const typeResult = applyGroupPredictions({
    existingGroup: existingScores.typeScores,
    predictedGroup: predictionScores.typeScores,
    fieldDiagnostics: fieldDiagnostics.typeScores,
    keys: TYPE_SCORE_KEYS,
    minConfidence: normalizedMinConfidence,
    minNeighborCount: normalizedMinNeighborCount,
  });
  const instinctResult = applyGroupPredictions({
    existingGroup: existingScores.instinctScores,
    predictedGroup: predictionScores.instinctScores,
    fieldDiagnostics: fieldDiagnostics.instinctScores,
    keys: INSTINCT_SCORE_KEYS,
    minConfidence: normalizedMinConfidence,
    minNeighborCount: normalizedMinNeighborCount,
  });
  const centerResult = applyGroupPredictions({
    existingGroup: existingScores.centerScores,
    predictedGroup: predictionScores.centerScores,
    fieldDiagnostics: fieldDiagnostics.centerScores,
    keys: CENTER_SCORE_KEYS,
    minConfidence: normalizedMinConfidence,
    minNeighborCount: normalizedMinNeighborCount,
  });

  const nextProfile = {
    ...normalizedProfile,
    typeScores: {
      ...(normalizeOptionalObject(normalizedProfile?.typeScores)),
      ...typeResult.merged,
    },
    instinctScores: {
      ...(normalizeOptionalObject(normalizedProfile?.instinctScores)),
      ...instinctResult.merged,
    },
    centerScores: {
      ...(normalizeOptionalObject(normalizedProfile?.centerScores)),
      ...centerResult.merged,
    },
    _mlScoreLearning: {
      modelVersion: String(normalizedPrediction?.modelVersion || ML_SCORE_MODEL_VERSION),
      appliedAt: new Date().toISOString(),
      thresholds: {
        minConfidence: normalizedMinConfidence,
        minNeighborCount: normalizedMinNeighborCount,
      },
      overallConfidence: toFiniteNumber(normalizedPrediction?.overallConfidence) ?? 0,
      groupConfidence: normalizeOptionalObject(normalizedPrediction?.groupConfidence),
    },
  };

  const appliedCounts = {
    typeScores: typeResult.appliedCount,
    instinctScores: instinctResult.appliedCount,
    centerScores: centerResult.appliedCount,
    total: typeResult.appliedCount + instinctResult.appliedCount + centerResult.appliedCount,
  };

  return {
    parsedProfile: nextProfile,
    appliedScores: {
      typeScores: typeResult.applied,
      instinctScores: instinctResult.applied,
      centerScores: centerResult.applied,
    },
    appliedCounts,
    thresholds: {
      minConfidence: normalizedMinConfidence,
      minNeighborCount: normalizedMinNeighborCount,
    },
    remainingNullCounts: {
      typeScores: TYPE_SCORE_KEYS.length - countNonNullScores(nextProfile?.typeScores),
      instinctScores: INSTINCT_SCORE_KEYS.length - countNonNullScores(nextProfile?.instinctScores),
      centerScores: CENTER_SCORE_KEYS.length - countNonNullScores(nextProfile?.centerScores),
    },
  };
}

export function buildScoreComparisonMetrics({
  candidateScores,
  groundTruthScores,
} = {}) {
  const candidate = normalizeScorePayload(candidateScores);
  const groundTruth = normalizeScorePayload(groundTruthScores);
  const groups = [
    ["typeScores", TYPE_SCORE_KEYS],
    ["instinctScores", INSTINCT_SCORE_KEYS],
    ["centerScores", CENTER_SCORE_KEYS],
  ];

  let totalCompared = 0;
  let exactMatchCount = 0;
  let absErrorSum = 0;
  let squaredErrorSum = 0;
  let signedErrorSum = 0;

  groups.forEach(([groupName, keys]) => {
    keys.forEach((key) => {
      const candidateValue = toScore(candidate?.[groupName]?.[key]);
      const actualValue = toScore(groundTruth?.[groupName]?.[key]);
      if (candidateValue == null || actualValue == null) return;

      const delta = candidateValue - actualValue;
      totalCompared += 1;
      if (delta === 0) exactMatchCount += 1;
      absErrorSum += Math.abs(delta);
      squaredErrorSum += delta * delta;
      signedErrorSum += delta;
    });
  });

  if (totalCompared === 0) {
    return {
      totalCompared: 0,
      exactMatchCount: 0,
      exactMatchRate: null,
      meanAbsoluteError: null,
      rootMeanSquaredError: null,
      meanSignedError: null,
    };
  }

  return {
    totalCompared,
    exactMatchCount,
    exactMatchRate: roundTo(exactMatchCount / totalCompared, 4),
    meanAbsoluteError: roundTo(absErrorSum / totalCompared, 4),
    rootMeanSquaredError: roundTo(Math.sqrt(squaredErrorSum / totalCompared), 4),
    meanSignedError: roundTo(signedErrorSum / totalCompared, 4),
  };
}

function computeWeightedAggregate(items) {
  const usable = items.filter((item) =>
    item &&
    Number.isFinite(Number(item.totalCompared)) &&
    Number(item.totalCompared) > 0 &&
    Number.isFinite(Number(item.meanAbsoluteError)) &&
    Number.isFinite(Number(item.rootMeanSquaredError))
  );
  if (!usable.length) return null;

  let totalCompared = 0;
  let exactMatchCount = 0;
  let absoluteErrorTotal = 0;
  let squaredErrorTotal = 0;

  usable.forEach((item) => {
    const compared = Number(item.totalCompared);
    const mae = Number(item.meanAbsoluteError);
    const rmse = Number(item.rootMeanSquaredError);
    const exact = Number(item.exactMatchCount || 0);

    totalCompared += compared;
    exactMatchCount += exact;
    absoluteErrorTotal += mae * compared;
    squaredErrorTotal += (rmse * rmse) * compared;
  });

  if (totalCompared <= 0) return null;
  return {
    totalCompared,
    exactMatchCount,
    exactMatchRate: roundTo(exactMatchCount / totalCompared, 4),
    meanAbsoluteError: roundTo(absoluteErrorTotal / totalCompared, 4),
    rootMeanSquaredError: roundTo(Math.sqrt(squaredErrorTotal / totalCompared), 4),
  };
}

export function aggregateMlFeedbackMetricsFromReportRows(rows) {
  const reportRows = Array.isArray(rows) ? rows : [];
  const parserMetrics = [];
  const modelMetrics = [];
  let labeledReportCount = 0;

  reportRows.forEach((row) => {
    const results = readResultsObject(row);
    const feedback = normalizeOptionalObject(results?.ml?.feedback);
    const evaluation = normalizeOptionalObject(feedback?.evaluation);
    const parserVsGroundTruth = normalizeOptionalObject(evaluation?.parserVsGroundTruth);
    const modelVsGroundTruth = normalizeOptionalObject(evaluation?.modelVsGroundTruth);

    const parserCompared = Number(parserVsGroundTruth?.totalCompared ?? 0);
    if (parserCompared > 0) {
      labeledReportCount += 1;
      parserMetrics.push(parserVsGroundTruth);
    }
    const modelCompared = Number(modelVsGroundTruth?.totalCompared ?? 0);
    if (modelCompared > 0) {
      modelMetrics.push(modelVsGroundTruth);
    }
  });

  const parserAggregate = computeWeightedAggregate(parserMetrics);
  const modelAggregate = computeWeightedAggregate(modelMetrics);
  const parserMae = Number(parserAggregate?.meanAbsoluteError);
  const modelMae = Number(modelAggregate?.meanAbsoluteError);
  const hasComparableMae = Number.isFinite(parserMae) && Number.isFinite(modelMae) && parserMae > 0;
  const absoluteMaeImprovement = hasComparableMae ? roundTo(parserMae - modelMae, 4) : null;
  const relativeMaeImprovementPercent = hasComparableMae
    ? roundTo(((parserMae - modelMae) / parserMae) * 100, 3)
    : null;

  return {
    modelVersion: ML_SCORE_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    labeledReportCount,
    parserVsGroundTruth: parserAggregate,
    modelVsGroundTruth: modelAggregate,
    absoluteMaeImprovement,
    relativeMaeImprovementPercent,
  };
}

export async function applyMlScoreLearningToParsedProfile({
  supabase,
  table,
  parsedProfile,
  reportId,
  maxRows = 250,
  minTrainingExamples = 4,
  topK = 8,
  minNeighborsPerField = 2,
  minConfidence = 0.62,
  minNeighborCount = 2,
} = {}) {
  const baseProfile = normalizeOptionalObject(parsedProfile);
  if (!supabase || typeof supabase.from !== "function") {
    return {
      parsedProfile: baseProfile,
      ml: {
        modelVersion: ML_SCORE_MODEL_VERSION,
        status: "skipped",
        reason: "missing_supabase_client",
      },
    };
  }

  const reportsTable = String(table || "").trim();
  if (!reportsTable) {
    return {
      parsedProfile: baseProfile,
      ml: {
        modelVersion: ML_SCORE_MODEL_VERSION,
        status: "skipped",
        reason: "missing_reports_table",
      },
    };
  }

  let rows = [];
  const excludeReportId = String(reportId || "").trim();
  try {
    const { data, error } = await supabase
      .from(reportsTable)
      .select("id,created_at,results_data")
      .order("created_at", { ascending: false })
      .limit(Math.max(25, Math.floor(Number(maxRows) || 250)));

    if (error) {
      return {
        parsedProfile: baseProfile,
        ml: {
          modelVersion: ML_SCORE_MODEL_VERSION,
          status: "skipped",
          reason: "training_query_failed",
          details: error.message,
        },
      };
    }
    rows = Array.isArray(data) ? data : [];
  } catch (error) {
    return {
      parsedProfile: baseProfile,
      ml: {
        modelVersion: ML_SCORE_MODEL_VERSION,
        status: "skipped",
        reason: "training_query_exception",
        details: String(error?.message || error),
      },
    };
  }

  const { examples, diagnostics } = buildMlTrainingExamplesFromReportRows(rows, {
    excludeReportId,
  });
  if (examples.length < Math.max(1, Math.floor(Number(minTrainingExamples) || 1))) {
    return {
      parsedProfile: baseProfile,
      ml: {
        modelVersion: ML_SCORE_MODEL_VERSION,
        status: "skipped",
        reason: "insufficient_training_examples",
        training: diagnostics,
      },
    };
  }

  const prediction = predictMlScoresFromExamples({
    examples,
    parsedProfile: baseProfile,
    topK,
    minNeighborsPerField,
  });
  if (!prediction.eligible) {
    return {
      parsedProfile: baseProfile,
      ml: {
        modelVersion: ML_SCORE_MODEL_VERSION,
        status: "skipped",
        reason: prediction.reason || "prediction_not_eligible",
        training: diagnostics,
        prediction,
      },
    };
  }

  const applied = applyMlPredictionsToParsedProfile({
    parsedProfile: baseProfile,
    mlPrediction: prediction,
    minConfidence,
    minNeighborCount,
  });

  return {
    parsedProfile: applied.parsedProfile,
    ml: {
      modelVersion: ML_SCORE_MODEL_VERSION,
      status: applied.appliedCounts.total > 0 ? "applied" : "suggested",
      appliedAt: new Date().toISOString(),
      training: diagnostics,
      prediction: {
        modelVersion: prediction.modelVersion,
        trainingSampleCount: prediction.trainingSampleCount,
        candidateNeighborCount: prediction.candidateNeighborCount,
        usedNeighborCount: prediction.usedNeighborCount,
        topNeighbors: prediction.topNeighbors,
        scores: prediction.prediction,
        groupConfidence: prediction.groupConfidence,
        overallConfidence: prediction.overallConfidence,
      },
      applied: {
        appliedCounts: applied.appliedCounts,
        appliedScores: applied.appliedScores,
        thresholds: applied.thresholds,
        remainingNullCounts: applied.remainingNullCounts,
      },
    },
  };
}
