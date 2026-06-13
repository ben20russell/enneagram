import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readReportScript() {
  return readFileSync(path.join(process.cwd(), "public", "report.js"), "utf8");
}

test("team-stage targeted extraction supports alias section keys beyond team_dynamics", () => {
  const script = readReportScript();
  assert.match(
    script,
    /team_stage_breakdown/,
    "Expected targeted team-stage extraction to support `team_stage_breakdown` payloads.",
  );
  assert.match(
    script,
    /teamStages|team_stages/,
    "Expected targeted team-stage extraction to support camel/snake case `team stages` payload aliases.",
  );
});

test("team-stage targeted extraction can fall back to snippet parsing when section value is serialized text", () => {
  const script = readReportScript();
  assert.match(
    script,
    /extractTeamStageSnippet\(\s*normalized/,
    "Expected targeted team-stage extraction to parse serialized text blocks with stage snippet extraction.",
  );
});
