import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");

function readPanel() {
  return readFileSync(panelPath, "utf8");
}

test("admin review save button shows a checkmark after save and upload completion", () => {
  const source = readPanel();

  assert.match(
    source,
    /const\s*\[\s*lastSavedReportId,\s*setLastSavedReportId\s*\]\s*=\s*useState\(""\)/,
    "Expected admin review panel to track which report finished saving.",
  );

  assert.match(
    source,
    /await\s+loadQueue\(\)\s*;\s*setLastSavedReportId\(\s*selectedIdForSave\s*\)/,
    "Expected submitReview success flow to set checkmark state only after queue reload completes.",
  );

  assert.match(
    source,
    /lastSavedReportId\s*===\s*selected\?\.id\s*\?\s*"✓"\s*:\s*"Save Review"/,
    "Expected Save Review button label to switch to a checkmark for the saved report.",
  );
});
