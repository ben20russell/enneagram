import test from "node:test";
import assert from "node:assert/strict";
import { extractClientNameFromReportFileName } from "./reportFileNameClientName.js";

test("extractClientNameFromReportFileName resolves names from common iEQ9 report file names", () => {
  assert.equal(
    extractClientNameFromReportFileName("iEQ9 Corinne Aparis PRO UPDATED.pdf"),
    "Corinne Aparis",
  );
  assert.equal(
    extractClientNameFromReportFileName("iEQ9 Corinne Aparis PRO.pdf"),
    "Corinne Aparis",
  );
  assert.equal(
    extractClientNameFromReportFileName("iEQ9 Ben Russell PRO.pdf"),
    "Ben Russell",
  );
  assert.equal(
    extractClientNameFromReportFileName("iEQ9-Wayshine-Tseng-STD.pdf"),
    "Wayshine Tseng",
  );
});

test("extractClientNameFromReportFileName returns null for generic non-person file names", () => {
  assert.equal(extractClientNameFromReportFileName("report.pdf"), null);
  assert.equal(extractClientNameFromReportFileName("custom-report.pdf"), null);
  assert.equal(extractClientNameFromReportFileName("enneagram_profile_v2.pdf"), null);
});
