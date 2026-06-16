import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadScript() {
  const scriptPath = path.join(process.cwd(), "scripts", "extract_ieq9_sections.py");
  return readFileSync(scriptPath, "utf8");
}

function loadSharedConfig() {
  const configPath = path.join(process.cwd(), "config", "ieq9_targeted_extraction_config.json");
  return JSON.parse(readFileSync(configPath, "utf8"));
}

test("iEQ9 shared extraction config defines canonical section page map", () => {
  const config = loadSharedConfig();

  assert.deepEqual(config?.section_page_map?.strain_interpretation, [20, 21, 22]);
  assert.deepEqual(config?.section_page_map?.body_language, [25]);
  assert.deepEqual(config?.section_page_map?.feedback_guide, [28, 29]);
  assert.deepEqual(config?.section_page_map?.decision_framework, [32, 33, 34]);
  assert.deepEqual(config?.section_page_map?.strategic_leadership, [37, 38]);
  assert.deepEqual(config?.section_page_map?.team_dynamics, [39, 40, 41]);
  assert.deepEqual(config?.section_page_map?.coaching_relationship, [42]);
  assert.deepEqual(config?.section_page_map?.development_exercises, [7, 11, 13, 17, 19, 31, 36, 38]);
  assert.equal(
    Array.isArray(config?.section_header_titles?.strain_interpretation)
      ? config.section_header_titles.strain_interpretation.includes("Your Overall Strain Level")
      : false,
    false,
    "Expected strain_interpretation targeted headers to focus on individual strain sections only.",
  );
});

test("iEQ9 extraction script reads page maps/schema from shared config file", () => {
  const source = loadScript();

  assert.match(
    source,
    /ieq9_targeted_extraction_config\.json/,
  );
  assert.match(source, /json\.loads\(/);
});

test("iEQ9 extraction script strips cid artifacts before section bounding and prompt payload assembly", () => {
  const source = loadScript();

  assert.match(
    source,
    /strip_cid_artifacts|CID_ARTIFACT_PATTERN/i,
    "Expected iEQ9 extraction script to define explicit cid artifact cleanup.",
  );
  assert.match(
    source,
    /normalize_spaces\([\s\S]*strip_cid_artifacts|strip_footer\([\s\S]*strip_cid_artifacts/i,
    "Expected iEQ9 extraction cleanup flow to remove cid artifacts before regex section bounding.",
  );
});

test("iEQ9 extraction script enforces strict JSON schema for OpenAI structuring", () => {
  const source = loadScript();
  const config = loadSharedConfig();

  assert.match(source, /"response_format"\s*:\s*\{/);
  assert.match(source, /"type"\s*:\s*"json_schema"/);
  assert.match(source, /"strict"\s*:\s*True/);
  assert.equal(config?.output_schema?.type, "object");
  assert.ok(config?.output_schema?.properties?.strain_interpretation);
  assert.ok(config?.output_schema?.properties?.body_language);
  assert.ok(config?.output_schema?.properties?.feedback_guide);
  assert.ok(config?.output_schema?.properties?.decision_framework);
  assert.ok(config?.output_schema?.properties?.strategic_leadership);
  assert.ok(config?.output_schema?.properties?.team_dynamics);
  assert.ok(config?.output_schema?.properties?.coaching_relationship);
  assert.ok(config?.output_schema?.properties?.development_exercises);
});

test("parsePdf runtime no longer depends on shared targeted extraction config", () => {
  const parsePdfSource = readFileSync(path.join(process.cwd(), "lib", "parsePdf.js"), "utf8");
  const configLoaderSource = readFileSync(path.join(process.cwd(), "lib", "ieq9TargetedExtractionConfig.js"), "utf8");
  assert.doesNotMatch(parsePdfSource, /ieq9TargetedExtractionConfig\.js/);
  assert.match(configLoaderSource, /ieq9_targeted_extraction_config\.json/);
});
