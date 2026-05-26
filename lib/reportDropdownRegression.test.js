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

test("report dashboard loads interaction logic from external script", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /<script\s+src="\/report\.js(?:\?[^\"]*)?"\s*><\/script>/i,
    "Expected report.html to include public/report.js",
  );

  assert.doesNotMatch(
    html,
    /<script>\s*const\s+AUTH_BASE_URL[\s\S]*<\/script>/i,
    "Expected the inline dashboard logic block to be removed from report.html",
  );
});

test("external report script keeps example dropdown handler", () => {
  const script = read(reportJsPath);

  assert.match(script, /function\s+onReportSelectorChange\s*\(/, "Missing selector change handler");
  assert.match(script, /applyReport\(selectedType\)/, "Expected selector handler to apply selected type");
  assert.match(script, /setupReportSelectorHandler\(\)/, "Expected selector setup to be present");
});

test("admin page auth menu link opens in a new tab", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /id="authAdminPageLink"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/i,
    "Expected Admin Page menu link to open in a new tab and keep current page unchanged",
  );
});
