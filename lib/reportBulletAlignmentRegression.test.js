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
    /\.tic\{[^}]*margin-top:-2px[^}]*\}/,
    "Expected shared bullet marker to use a universal negative top offset for first-line centering.",
  );
});
