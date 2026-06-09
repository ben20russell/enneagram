import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");

function readPanel() {
  return readFileSync(panelPath, "utf8");
}

test("admin review save payload includes explicit primary type fallback from preset selection", () => {
  const source = readPanel();

  assert.match(
    source,
    /primaryType:\s*primaryTypePreset\s*\?\s*Number\(primaryTypePreset\)\s*:\s*null/,
    "Expected admin review submit payload to include selected primaryType preset fallback.",
  );

  assert.match(
    source,
    /Saved review\.[\s\S]*Type:\s*\$\{data\?\.enneagramType\s*\|\|\s*"n\/a"\}/,
    "Expected save status copy to report the persisted enneagram type.",
  );
});
