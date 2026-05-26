import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportHtmlPath = path.join(repoRoot, "public", "report.html");
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("core identity shows Stretch Point before Release Point with swapped value colors", () => {
  const html = read(reportHtmlPath);

  const stretchIndex = html.indexOf('id="stretchValue"');
  const releaseIndex = html.indexOf('id="releaseValue"');

  assert.ok(stretchIndex >= 0, "Expected stretchValue element");
  assert.ok(releaseIndex >= 0, "Expected releaseValue element");
  assert.ok(stretchIndex < releaseIndex, "Expected Stretch Point to render before Release Point");

  assert.match(
    html,
    /<div><div class="kvl">Stretch Point<\/div><div class="kvv green" id="stretchValue">/,
    "Expected Stretch Point value to use green style",
  );
  assert.match(
    html,
    /<div><div class="kvl">Release Point<\/div><div class="kvv blue" id="releaseValue">/,
    "Expected Release Point value to use blue style",
  );
  assert.match(html, /\.kvv\.blue\{color:var\(--blue\);font-weight:600\}/, "Expected kvv.blue style definition");
});

test("profile wheel release and stretch colors are swapped", () => {
  const script = read(reportJsPath);

  assert.match(script, /release:\s*'#1f8ec8'/, "Expected release color to be blue");
  assert.match(script, /stretch:\s*'#12b981'/, "Expected stretch color to be green");
});
