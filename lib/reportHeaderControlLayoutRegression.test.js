import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportHtmlPath = path.join(repoRoot, "public", "report.html");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("header controls lay out report selectors in a shared horizontal row", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.header-controls\{[^}]*display:flex[^}]*flex-wrap:wrap[^}]*gap:/,
    "Expected header controls to use a flex row layout so Example Report and Client Reports selectors sit side-by-side.",
  );

  assert.match(
    html,
    /<div class="header-controls">[\s\S]*id="reportSwitchControl"[\s\S]*id="clientReportSwitchControl"[\s\S]*<\/div>/,
    "Expected both selector controls to remain grouped inside the shared header controls container.",
  );
});
