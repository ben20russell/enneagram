import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const reportHtmlPath = path.join(process.cwd(), "public", "report.html");

function read(filePath) {
  return readFileSync(filePath, "utf8");
}

test("global bullet rows keep text top-aligned while centering marker to the first line", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.ti\{[^}]*align-items:flex-start[^}]*\}/,
    "Expected shared bullet row wrapper to keep text top-aligned.",
  );

  assert.match(
    html,
    /\.tic\{[^}]*--bullet-size:26px[^}]*margin-top:calc\(\(\(var\(--fs-body\)\s*\*\s*var\(--lh-body\)\)\s*-\s*var\(--bullet-size\)\)\s*\/\s*2\)[^}]*\}/,
    "Expected shared bullet marker to derive first-line centering from a universal size-aware rule.",
  );

  assert.match(
    html,
    /\.core-pattern-row-marker\{[^}]*--bullet-size:20px[^}]*\}/,
    "Expected core-pattern bullet marker to opt into the same shared alignment rule via bullet-size.",
  );

  assert.match(
    html,
    /\.strain-detail-row-icon\{[^}]*--bullet-size:18px[^}]*\}/,
    "Expected strain-detail bullet marker to opt into the same shared alignment rule via bullet-size.",
  );
});
