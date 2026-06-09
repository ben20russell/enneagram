import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const routePath = path.join(process.cwd(), "app", "api", "admin-review", "route.js");
const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");

function readRoute() {
  return readFileSync(routePath, "utf8");
}

function readPanel() {
  return readFileSync(panelPath, "utf8");
}

test("admin review GET route returns pending queue and previously graded reports", () => {
  const source = readRoute();

  assert.match(
    source,
    /const queue = [\s\S]*?\.filter\(\(item\) => item\.reviewStatus === "needs_review"\)/,
    "Expected queue list to keep only reports that still need review.",
  );

  assert.match(
    source,
    /const reviewedReports = [\s\S]*?\.filter\(\(item\) => item\.reviewStatus !== "needs_review"\)/,
    "Expected admin review route to expose previously graded reports for lookup/regrade.",
  );

  assert.match(
    source,
    /NextResponse\.json\(\{ queue, reviewedReports, mlMetrics \}, \{ status: 200 \}\)/,
    "Expected admin review GET response to include reviewedReports in addition to queue.",
  );
});

test("admin review dropdown shows pending and previously graded report groups", () => {
  const source = readPanel();

  assert.match(
    source,
    /const \[reviewedReports, setReviewedReports\] = useState\(\[\]\);/,
    "Expected admin review panel to track previously graded reports.",
  );

  assert.match(
    source,
    /const nextReviewedReports = Array\.isArray\(data\?\.reviewedReports\) \? data\.reviewedReports : \[\];/,
    "Expected admin review panel to hydrate reviewed reports from GET response.",
  );

  assert.match(
    source,
    /<optgroup label="Pending reports">/,
    "Expected dropdown to keep pending reports in a dedicated option group.",
  );

  assert.match(
    source,
    /<optgroup label="Previously graded reports">/,
    "Expected dropdown to include previously graded reports for regrade access.",
  );

  assert.match(
    source,
    /disabled=\{!selectableReports\.length\}/,
    "Expected dropdown disable state to depend on the combined selectable report list.",
  );
});
