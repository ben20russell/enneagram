import test from "node:test";
import assert from "node:assert/strict";
import {
  ML_EXTRACTION_MODEL_VERSION,
  buildMlExtractionLearningContextFromReportRows,
} from "./mlExtractionLearning.js";

function buildRow({
  id,
  reviewStatus = "approved",
  groundTruthIdentity = null,
  parsedProfile = {},
  dashboardContext = {},
}) {
  return {
    id,
    created_at: "2026-06-11T10:00:00.000Z",
    results_data: {
      review: {
        status: reviewStatus,
      },
      ml: {
        feedback: {
          groundTruthIdentity,
        },
      },
      parsedProfile,
      dashboardContext,
    },
  };
}

test("buildMlExtractionLearningContextFromReportRows builds active priors from reviewed reports", () => {
  const rows = [
    buildRow({
      id: "r1",
      parsedProfile: {
        primaryType: 8,
        typeName: "Active Controller",
        instinctualVariant: "sx",
        integrationLevel: "Low",
      },
    }),
    buildRow({
      id: "r2",
      parsedProfile: {
        primaryType: 8,
        typeName: "Active Controller",
        instinctualVariant: "sx",
        integrationLevel: "Moderate",
      },
    }),
    buildRow({
      id: "r3",
      parsedProfile: {
        primaryType: 3,
        typeName: "Driven Achiever",
        instinctualVariant: "so",
        integrationLevel: "Moderate",
      },
    }),
  ];

  const context = buildMlExtractionLearningContextFromReportRows(rows, {
    excludeReportId: "target-report",
    minTrainingExamples: 2,
  });

  assert.equal(context.modelVersion, ML_EXTRACTION_MODEL_VERSION);
  assert.equal(context.status, "active");
  assert.equal(context.reason, null);
  assert.equal(context.training.trainingSampleCount, 3);
  assert.equal(context.training.scannedRowCount, 3);
  assert.equal(Array.isArray(context.priors.topTypes), true);
  assert.equal(context.priors.topTypes[0]?.typeNumber, 8);
  assert.equal(context.priors.topInstincts[0]?.instinctualVariant, "sx");
  assert.equal(typeof context.promptHintText, "string");
  assert.match(context.promptHintText, /Type 8/i);
  assert.ok(context.hintCount > 0);
});

test("buildMlExtractionLearningContextFromReportRows skips context when training sample count is too low", () => {
  const rows = [
    buildRow({
      id: "only-one",
      reviewStatus: "approved",
      parsedProfile: {
        primaryType: 9,
        instinctualVariant: "sp",
      },
    }),
  ];

  const context = buildMlExtractionLearningContextFromReportRows(rows, {
    minTrainingExamples: 3,
  });

  assert.equal(context.modelVersion, ML_EXTRACTION_MODEL_VERSION);
  assert.equal(context.status, "skipped");
  assert.equal(context.reason, "insufficient_training_examples");
  assert.equal(context.promptHintText, "");
  assert.equal(context.hintCount, 0);
  assert.equal(context.training.trainingSampleCount, 1);
});
