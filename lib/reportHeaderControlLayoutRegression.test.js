import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportHtmlPath = path.join(repoRoot, "public", "report.html");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("header keeps report selectors grouped in a hidden dormant container", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /<div class="header-controls"[^>]*style="display:none"[^>]*>/,
    "Expected selector controls container to be hidden from the dashboard while dormant.",
  );

  assert.match(
    html,
    /<div class="header-controls"[^>]*>[\s\S]*id="reportSwitchControl"[\s\S]*id="clientReportSwitchControl"[\s\S]*<\/div>/,
    "Expected both selector controls to remain grouped inside header controls so they can be re-enabled later.",
  );
});
