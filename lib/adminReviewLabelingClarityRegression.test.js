import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");

function readPanel() {
  return readFileSync(panelPath, "utf8");
}

test("admin review panel includes explicit binary labeling guidance copy", () => {
  const source = readPanel();
  assert.match(
    source,
    /Primary type: set one type to 100 and all others to 0\./,
    "Expected binary primary-type labeling guidance to be visible in admin review UI.",
  );
  assert.match(
    source,
    /Dominant instinct: set one to 100 and the others to 0\./,
    "Expected dominant-instinct guidance in admin review UI.",
  );
  assert.match(
    source,
    /Dominant center: set one to 100 and the others to 0\./,
    "Expected dominant-center guidance in admin review UI.",
  );
});

test("admin review panel exposes quick preset controls for primary type, instinct, and center", () => {
  const source = readPanel();
  assert.match(
    source,
    /data-testid="admin-review-primary-type-select"/,
    "Expected primary type quick-select control test id.",
  );
  assert.match(
    source,
    /data-testid="admin-review-primary-type-apply"/,
    "Expected primary type quick-apply button test id.",
  );
  assert.match(
    source,
    /data-testid="admin-review-dominant-instinct-select"/,
    "Expected dominant instinct quick-select control test id.",
  );
  assert.match(
    source,
    /data-testid="admin-review-dominant-instinct-apply"/,
    "Expected dominant instinct quick-apply button test id.",
  );
  assert.match(
    source,
    /data-testid="admin-review-dominant-center-select"/,
    "Expected dominant center quick-select control test id.",
  );
  assert.match(
    source,
    /data-testid="admin-review-dominant-center-apply"/,
    "Expected dominant center quick-apply button test id.",
  );
  assert.match(
    source,
    /function applyPrimaryTypePreset\(/,
    "Expected helper for writing 100\/0 primary type presets.",
  );
  assert.match(
    source,
    /function applyDominantPreset\(/,
    "Expected shared helper for writing 100\/0 dominant presets.",
  );
});
