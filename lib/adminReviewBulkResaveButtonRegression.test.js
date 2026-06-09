import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");

function readPanel() {
  return readFileSync(panelPath, "utf8");
}

test("admin review panel exposes force re-save action for graded reports", () => {
  const source = readPanel();

  assert.match(
    source,
    /async function handleForceResaveGradedReports\(/,
    "Expected Admin Review panel to define a handler for bulk graded-report re-save.",
  );

  assert.match(
    source,
    /fetch\("\/api\/admin-review\/resave-graded",\s*\{\s*method:\s*"POST"/,
    "Expected bulk re-save handler to call the dedicated admin-review API route.",
  );

  assert.match(
    source,
    /data-testid="admin-review-force-resave-graded"/,
    "Expected Admin Review controls to render a force re-save button for graded reports.",
  );
});
