import test from "node:test";
import assert from "node:assert/strict";
import {
  inferReportTypeFromFileName,
  resolveMinExpectedPagesByReportType,
} from "./reportTypePageThresholds.js";

test("report type inference resolves STD and PRO from filename tokens", () => {
  assert.equal(
    inferReportTypeFromFileName("iEQ9-Wayshine-Tseng-STD.pdf"),
    "STD",
    "Expected STD reports to be inferred from filename token.",
  );

  assert.equal(
    inferReportTypeFromFileName("iEQ9 Corinne Aparis PRO UPDATED.pdf"),
    "PRO",
    "Expected PRO reports to be inferred from filename token.",
  );

  assert.equal(
    inferReportTypeFromFileName("iEQ9 Corinne Aparis.pdf"),
    null,
    "Expected null report type when STD/PRO token is absent.",
  );
});

test("min expected pages resolve by report type with fallback support", () => {
  assert.equal(
    resolveMinExpectedPagesByReportType({
      fileName: "iEQ9-Wayshine-Tseng-STD.pdf",
      fallbackMinExpectedPages: 20,
    }),
    16,
    "Expected STD reports to use 16-page threshold.",
  );

  assert.equal(
    resolveMinExpectedPagesByReportType({
      fileName: "iEQ9 Ben Russell PRO.pdf",
      fallbackMinExpectedPages: 20,
    }),
    42,
    "Expected PRO reports to use 42-page threshold.",
  );

  assert.equal(
    resolveMinExpectedPagesByReportType({
      fileName: "custom-report.pdf",
      fallbackMinExpectedPages: 24,
    }),
    24,
    "Expected unknown report type to preserve existing fallback threshold.",
  );

  assert.equal(
    resolveMinExpectedPagesByReportType({
      fileName: "custom-report.pdf",
      fallbackMinExpectedPages: null,
    }),
    20,
    "Expected unknown report type without fallback to use default threshold.",
  );
});
