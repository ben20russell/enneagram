import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const layoutPath = path.join(repoRoot, "app", "layout.jsx");
const globalsCssPath = path.join(repoRoot, "app", "globals.css");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("root layout avoids inline body style to prevent hydration style mismatches", () => {
  const layout = read(layoutPath);

  assert.match(
    layout,
    /import\s+["']\.\/globals\.css["'];/,
    "Expected root layout to import app/globals.css for body reset styles",
  );

  assert.doesNotMatch(
    layout,
    /<body[^>]*style=\{\{/,
    "Body should not use inline style props that can conflict with client-side style mutations",
  );

  assert.match(
    layout,
    /<body[^>]*suppressHydrationWarning/,
    "Body should suppress hydration warnings for client-side style mutations from browser tooling",
  );
});

test("global css resets body margin without using inline style attributes", () => {
  const globalsCss = read(globalsCssPath);

  assert.match(
    globalsCss,
    /body\s*\{[\s\S]*margin:\s*0(?:px)?\s*;/,
    "Expected app/globals.css to define a body margin reset",
  );
});
