import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const pdfParseRoutePath = path.join(repoRoot, "app", "api", "pdf", "parse", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("pdf parse route passes non-blocking completeness policy and large-doc image guard options", () => {
  const source = read(pdfParseRoutePath);

  assert.match(
    source,
    /parsePdf\(\s*buffer\s*,\s*\{[\s\S]*imagePrimaryFullDocMaxPages:\s*routeImagePageLimit[\s\S]*requireChartScoresForComplete:\s*false[\s\S]*enablePythonCrossCheck:\s*true[\s\S]*\}\s*\)/,
    "Expected pdf parse route to pass large-doc image guard, disable strict chart-score completeness blocking, and enable Python cross-checking",
  );
});

test("pdf parse route exposes route-level large-doc image page limit constant", () => {
  const source = read(pdfParseRoutePath);

  assert.match(
    source,
    /const\s+DEFAULT_ROUTE_IMAGE_PAGE_LIMIT\s*=\s*\d+/,
    "Expected pdf parse route to define a default route-level image primary page limit",
  );
});
