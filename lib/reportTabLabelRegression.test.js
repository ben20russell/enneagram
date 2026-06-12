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

test("centers navigation tab is labeled Expressions & Instincts across desktop, mobile, and label maps", () => {
  const html = read(reportHtmlPath);
  const script = read(reportJsPath);

  assert.match(
    html,
    /data-sec="centers"[\s\S]*>Expressions &amp; Instincts<\/button>/,
    "Expected centers nav buttons to render the new Expressions & Instincts copy.",
  );

  assert.doesNotMatch(
    html,
    />Centers &amp; Instincts<\/button>/,
    "Expected legacy centers tab copy to be removed from report navigation.",
  );

  assert.match(
    script,
    /'Expressions & Instincts': 'centers'/,
    "Expected nav icon mapping to recognize the Expressions & Instincts label.",
  );

  assert.match(
    script,
    /centers:\s*'Expressions & Instincts'/,
    "Expected search/index section name map to use Expressions & Instincts.",
  );
});
