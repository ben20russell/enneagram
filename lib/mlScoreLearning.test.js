import test from "node:test";
import assert from "node:assert/strict";

import {
  ML_SCORE_MODEL_VERSION,
  aggregateMlFeedbackMetricsFromReportRows,
  applyMlPredictionsToParsedProfile,
  buildMlTrainingExamplesFromReportRows,
  buildScoreComparisonMetrics,
  predictMlScoresFromExamples,
} from "./mlScoreLearning.js";

function buildScorePayload(overrides = {}) {
  return {
    typeScores: {
      type1: null,
      type2: null,
      type3: null,
      type4: null,
      type5: null,
      type6: null,
      type7: null,
      type8: 100,
      type9: null,
    },
    instinctScores: {
      selfPreservation: null,
      social: null,
      sexual: 100,
    },
    centerScores: {
      head: null,
      heart: null,
      body: null,
    },
    ...overrides,
  };
}

test("ML score learner predicts missing chart values from reviewed examples and applies only null fields", () => {
  const rows = [
    {
      id: "report-1",
      results_data: {
        review: { status: "approved" },
        parsedProfile: {
          primaryType: 8,
          instinctualVariant: "sx",
          integrationLevel: "Low",
          typeScores: {
            type1: 10,
            type2: 20,
            type3: 30,
            type4: 40,
            type5: 50,
            type6: 60,
            type7: 70,
            type8: 100,
            type9: 80,
          },
          instinctScores: {
            selfPreservation: 20,
            social: 25,
            sexual: 100,
          },
          centerScores: {
            head: 35,
            heart: 45,
            body: 75,
          },
        },
      },
    },
    {
      id: "report-2",
      results_data: {
        review: { status: "approved" },
        parsedProfile: {
          primaryType: 8,
          instinctualVariant: "sx",
          integrationLevel: "Low",
          typeScores: {
            type1: 12,
            type2: 22,
            type3: 32,
            type4: 42,
            type5: 52,
            type6: 62,
            type7: 72,
            type8: 100,
            type9: 82,
          },
          instinctScores: {
            selfPreservation: 18,
            social: 28,
            sexual: 100,
          },
          centerScores: {
            head: 38,
            heart: 48,
            body: 78,
          },
        },
      },
    },
  ];

  const { examples, diagnostics } = buildMlTrainingExamplesFromReportRows(rows, {
    excludeReportId: "target",
  });
  assert.equal(diagnostics.trainingSampleCount, 2);
  assert.equal(examples.length, 2);

  const parsedProfile = {
    primaryType: 8,
    instinctualVariant: "sx",
    integrationLevel: "Low",
    ...buildScorePayload(),
  };

  const prediction = predictMlScoresFromExamples({
    examples,
    parsedProfile,
    topK: 2,
    minNeighborsPerField: 1,
  });

  assert.equal(prediction.modelVersion, ML_SCORE_MODEL_VERSION);
  assert.equal(prediction.eligible, true);
  assert.equal(prediction.trainingSampleCount, 2);
  assert.equal(typeof prediction.prediction?.typeScores?.type2, "number");
  assert.equal(typeof prediction.prediction?.instinctScores?.social, "number");
  assert.equal(typeof prediction.prediction?.centerScores?.heart, "number");

  const applied = applyMlPredictionsToParsedProfile({
    parsedProfile,
    mlPrediction: prediction,
    minConfidence: 0.1,
    minNeighborCount: 1,
  });

  assert.equal(applied.appliedCounts.total > 0, true);
  assert.equal(applied.parsedProfile.typeScores.type8, 100);
  assert.equal(typeof applied.parsedProfile.typeScores.type2, "number");
  assert.equal(typeof applied.parsedProfile.instinctScores.selfPreservation, "number");
  assert.equal(typeof applied.parsedProfile.centerScores.head, "number");
});

test("score comparison metrics aggregate MAE/RMSE and exact match counts", () => {
  const baseline = {
    typeScores: { type1: 20, type2: 40 },
    instinctScores: { social: 30 },
    centerScores: { head: 60 },
  };
  const groundTruth = {
    typeScores: { type1: 25, type2: 35 },
    instinctScores: { social: 20 },
    centerScores: { head: 60 },
  };

  const metrics = buildScoreComparisonMetrics({
    candidateScores: baseline,
    groundTruthScores: groundTruth,
  });

  assert.equal(metrics.totalCompared, 4);
  assert.equal(metrics.exactMatchCount, 1);
  assert.equal(metrics.meanAbsoluteError > 0, true);
  assert.equal(metrics.rootMeanSquaredError > 0, true);
});

test("aggregate feedback metrics reports parser-vs-model quality trend", () => {
  const rows = [
    {
      id: "labeled-1",
      results_data: {
        ml: {
          feedback: {
            labelSource: "admin-review",
            evaluation: {
              parserVsGroundTruth: {
                totalCompared: 10,
                exactMatchCount: 2,
                meanAbsoluteError: 15,
                rootMeanSquaredError: 19,
              },
              modelVsGroundTruth: {
                totalCompared: 10,
                exactMatchCount: 5,
                meanAbsoluteError: 8,
                rootMeanSquaredError: 11,
              },
            },
          },
        },
      },
    },
    {
      id: "labeled-2",
      results_data: {
        ml: {
          feedback: {
            labelSource: "admin-review",
            evaluation: {
              parserVsGroundTruth: {
                totalCompared: 5,
                exactMatchCount: 1,
                meanAbsoluteError: 12,
                rootMeanSquaredError: 13,
              },
              modelVsGroundTruth: {
                totalCompared: 5,
                exactMatchCount: 2,
                meanAbsoluteError: 10,
                rootMeanSquaredError: 12,
              },
            },
          },
        },
      },
    },
  ];

  const summary = aggregateMlFeedbackMetricsFromReportRows(rows);
  assert.equal(summary.labeledReportCount, 2);
  assert.equal(summary.parserVsGroundTruth.totalCompared, 15);
  assert.equal(summary.modelVsGroundTruth.totalCompared, 15);
  assert.equal(summary.absoluteMaeImprovement > 0, true);
  assert.equal(summary.relativeMaeImprovementPercent > 0, true);
});

test("training examples prefer admin-reviewed core identity labels over parsed identity fields", () => {
  const { examples, diagnostics } = buildMlTrainingExamplesFromReportRows([
    {
      id: "labeled-core-identity",
      results_data: {
        review: { status: "needs_review" },
        parsedProfile: {
          primaryType: 8,
          instinctualVariant: "sx",
          integrationLevel: "Low",
          subtypeKeyword: "Original keyword",
          connectedLineA: "Type 5",
          connectedLineB: "Type 2",
          typeScores: {
            type1: null,
            type2: null,
            type3: null,
            type4: null,
            type5: null,
            type6: null,
            type7: null,
            type8: 100,
            type9: null,
          },
          instinctScores: {
            selfPreservation: null,
            social: null,
            sexual: 100,
          },
          centerScores: {
            head: null,
            heart: null,
            body: null,
          },
        },
        ml: {
          feedback: {
            groundTruthScores: buildScorePayload(),
            groundTruthIdentity: {
              primaryType: "2",
              instinctualVariant: "sp",
              integrationLevel: "High",
              subtypeKeyword: "SP - 2",
              stretchPoint: "Type 1",
              releasePoint: "Type 4",
              typeName: "Considerate Helper Warm",
            },
          },
        },
      },
    },
  ]);

  assert.equal(diagnostics.trainingSampleCount, 1);
  assert.equal(examples.length, 1);
  assert.equal(examples[0]?.features?.primaryType, 2);
  assert.equal(examples[0]?.features?.instinctualVariant, "sp");
  assert.equal(examples[0]?.features?.integrationLevel, "high");
  assert.equal(examples[0]?.features?.subtypeKeyword, "sp - 2");
  assert.equal(examples[0]?.features?.releasePointType, 4);
  assert.equal(examples[0]?.features?.stretchPointType, 1);
});
