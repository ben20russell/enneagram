import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");

function readPanel() {
  return readFileSync(panelPath, "utf8");
}

test("admin review save button bypasses native required-field form validation", () => {
  const source = readPanel();

  assert.match(
    source,
    /async function submitReview\(event\)/,
    "Expected submitReview to accept the click/submit event so native submission can be prevented.",
  );

  assert.match(
    source,
    /event\?\.preventDefault\?\.\(\)/,
    "Expected submitReview to prevent native submit behavior that can block saves on incomplete fields.",
  );

  assert.match(
    source,
    /<button[^>]*(data-testid="admin-review-submit"[^>]*type="button"|type="button"[^>]*data-testid="admin-review-submit")[^>]*>/,
    "Expected Save Review control to explicitly use button type so native form validation cannot block saving.",
  );
});
