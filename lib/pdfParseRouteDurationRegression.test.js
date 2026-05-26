import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const pdfParseRoutePath = path.join(repoRoot, "app", "api", "pdf", "parse", "route.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("pdf parse route keeps maxDuration within Vercel Hobby limits", () => {
  const source = read(pdfParseRoutePath);

  const match = source.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  assert.ok(match, "Expected pdf parse route to export maxDuration");

  const maxDuration = Number(match[1]);
  assert.ok(
    Number.isFinite(maxDuration) && maxDuration >= 1 && maxDuration <= 300,
    "Expected pdf parse route maxDuration to stay within Hobby plan serverless limits (1-300s)",
  );
});
