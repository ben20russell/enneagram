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

test("core identity shows Release Point before Stretch Point with retained value colors", () => {
  const html = read(reportHtmlPath);

  const releaseIndex = html.indexOf('id="releaseValue"');
  const stretchIndex = html.indexOf('id="stretchValue"');

  assert.ok(releaseIndex >= 0, "Expected releaseValue element");
  assert.ok(stretchIndex >= 0, "Expected stretchValue element");
  assert.ok(releaseIndex < stretchIndex, "Expected Release Point to render before Stretch Point");

  assert.match(
    html,
    /<div><div class="kvl">Release Point<\/div><div class="kvv blue" id="releaseValue">/,
    "Expected Release Point value to use blue style",
  );
  assert.match(
    html,
    /<div><div class="kvl">Stretch Point<\/div><div class="kvv green" id="stretchValue">/,
    "Expected Stretch Point value to use green style",
  );
  assert.match(html, /\.kvv\.blue\{color:var\(--blue\);font-weight:600\}/, "Expected kvv.blue style definition");
});

test("profile wheel release and stretch colors are swapped", () => {
  const script = read(reportJsPath);

  assert.match(script, /release:\s*'#1f8ec8'/, "Expected release color to be blue");
  assert.match(script, /stretch:\s*'#12b981'/, "Expected stretch color to be green");
});

test("core identity traits include a Characteristics heading using kvl label style", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /<div class="kvl"[^>]*>Characteristics<\/div>\s*<div style="display:flex;gap:7px;flex-wrap:wrap(?:;margin-top:3\.3px)?" id="traitChips">/,
    "Expected Characteristics heading above trait chips using kvl style",
  );
});

test("core identity shows Release Point before Integration Level", () => {
  const html = read(reportHtmlPath);

  const releaseIndex = html.indexOf('id="releaseValue"');
  const integrationIndex = html.indexOf('id="integrationValueRow"');

  assert.ok(releaseIndex >= 0, "Expected releaseValue element");
  assert.ok(integrationIndex >= 0, "Expected integrationValueRow element");
  assert.ok(releaseIndex < integrationIndex, "Expected Release Point to render before Integration Level");
});

test("core identity characteristics chips include top spacing below heading", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:3\.3px" id="traitChips">/,
    "Expected trait chips row to include top spacing under Characteristics heading",
  );
});
