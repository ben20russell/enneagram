import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadScript() {
  const scriptPath = path.join(process.cwd(), "scripts", "extract_ieq9_sections.py");
  return readFileSync(scriptPath, "utf8");
}

test("iEQ9 extraction script defines canonical section page map", () => {
  const source = loadScript();

  assert.match(source, /"strain_interpretation"\s*:\s*list\(range\(18,\s*23\)\)/);
  assert.match(source, /"body_language"\s*:\s*\[25\]/);
  assert.match(source, /"feedback_guide"\s*:\s*\[28,\s*29\]/);
  assert.match(source, /"decision_framework"\s*:\s*list\(range\(32,\s*35\)\)/);
  assert.match(source, /"strategic_leadership"\s*:\s*\[37,\s*38\]/);
  assert.match(source, /"team_dynamics"\s*:\s*list\(range\(39,\s*42\)\)/);
  assert.match(source, /"coaching_relationship"\s*:\s*\[42\]/);
  assert.match(
    source,
    /"development_exercises"\s*:\s*\[\s*7,\s*11,\s*13,\s*17,\s*19,\s*31,\s*36,\s*38\s*\]/,
  );
});

test("iEQ9 extraction script includes regex footer stripping and lookbehind header bounds", () => {
  const source = loadScript();

  assert.match(
    source,
    /Copyright\\s\+\\d\{4\}-\\d\{4\}\\s\+Integrative\\s\+Enneagram\\s\+Solutions/,
  );
  assert.match(source, /\(\?<=[^)]{3,}\)/);
});

test("iEQ9 extraction script enforces strict JSON schema for OpenAI structuring", () => {
  const source = loadScript();

  assert.match(source, /"response_format"\s*:\s*\{/);
  assert.match(source, /"type"\s*:\s*"json_schema"/);
  assert.match(source, /"strict"\s*:\s*True/);
  assert.match(source, /"strain_interpretation"/);
  assert.match(source, /"body_language"/);
  assert.match(source, /"feedback_guide"/);
  assert.match(source, /"decision_framework"/);
  assert.match(source, /"strategic_leadership"/);
  assert.match(source, /"team_dynamics"/);
  assert.match(source, /"coaching_relationship"/);
  assert.match(source, /"development_exercises"/);
});
