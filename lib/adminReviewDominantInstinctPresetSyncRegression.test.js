import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");

function readPanel() {
  return readFileSync(panelPath, "utf8");
}

test("admin review dominant instinct preset syncs the core identity instinct variant", () => {
  const source = readPanel();

  assert.match(
    source,
    /function\s+mapInstinctScoreKeyToVariantCode\(/,
    "Expected a helper that maps instinct score keys to core identity instinct codes.",
  );

  assert.match(
    source,
    /if\s*\(\s*group\s*===\s*["']instinctScores["']\s*\)\s*\{[\s\S]*setCoreIdentity\(\(prev\)\s*=>\s*\(\{[\s\S]*instinctualVariant:\s*resolvedInstinctVariant\s*\|\|\s*prev\.instinctualVariant/s,
    "Expected instinct preset application to also update coreIdentity.instinctualVariant.",
  );
});
