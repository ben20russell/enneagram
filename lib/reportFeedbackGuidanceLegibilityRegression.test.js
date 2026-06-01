import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function loadDashboardScript() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  return readFileSync(reportScriptPath, "utf8");
}

test("feedback guide matrix renders summary and bullets for long guidance paragraphs", () => {
  const script = loadDashboardScript();

  assert.match(script, /function\s+extractFeedbackGuidancePoints\s*\(/);
  assert.match(script, /function\s+renderFeedbackGuidanceCell\s*\(/);
  assert.match(script, /const\s+collapsedLimit\s*=\s*3\s*;/);
  assert.match(script, /<strong>Summary:<\/strong>/);
  assert.match(script, /show more/i);
  assert.match(script, /show less/i);
  assert.match(script, /font-weight:400/);
  assert.match(
    script,
    /renderFeedbackGuidanceCell\(formatOptionalText\(row\.guidance,\s*"Not detected in assigned PDF\."\)\)/,
  );
});

test("feedback guidance formatting normalizes sentence punctuation before display", () => {
  const script = loadDashboardScript();

  assert.match(script, /function\s+ensureSentencePunctuation\s*\(/);
  assert.match(
    script,
    /extractFeedbackGuidancePoints[\s\S]*ensureSentencePunctuation\(row\)/,
  );
  assert.match(script, /summary\s*=\s*summarizeSentence\(points\[0\],\s*16\)/);
});
