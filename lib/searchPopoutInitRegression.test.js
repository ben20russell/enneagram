import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportScriptPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("search popout handlers are initialized before window load", () => {
  const script = read(reportScriptPath);
  const domReadyMatch = script.match(/window\.addEventListener\("DOMContentLoaded",\s*\(\)\s*=>\s*\{([\s\S]*?)\}\);/);
  const loadMatch = script.match(/window\.addEventListener\('load',\s*\(\)\s*=>\s*\{([\s\S]*?)\}\);/);

  assert.ok(domReadyMatch?.[1], "Expected a DOMContentLoaded initialization block");
  assert.ok(loadMatch?.[1], "Expected a window load initialization block");

  assert.match(domReadyMatch[1], /setupSearchPopoutHandlers\(\)/, "Expected setupSearchPopoutHandlers() to be called from DOMContentLoaded");

  assert.match(loadMatch[1], /setupSearchPopoutHandlers\(\)/, "Expected setupSearchPopoutHandlers() call to remain in window load for back-compat");
});
