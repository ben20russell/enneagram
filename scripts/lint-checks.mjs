import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function run(command) {
  return execSync(command, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`[lint] ${message}`);
  process.exitCode = 1;
}

function checkNodeSyntax() {
  const filesRaw = run(
    "rg --files -g '*.js' -g '*.mjs' -g '!node_modules' -g '!.next' -g '!dist' .",
  );
  const files = filesRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  files.forEach((file) => {
    try {
      run(`node --check ${JSON.stringify(file)}`);
    } catch (error) {
      fail(`Syntax check failed for ${file}`);
    }
  });
}

function checkReportSelectorBinding() {
  const reportHtmlPath = resolve("public/report.html");
  const reportScriptPath = resolve("public/report.js");
  const html = readFileSync(reportHtmlPath, "utf8");
  const script = readFileSync(reportScriptPath, "utf8");
  const hasInlineOnChange = /id="reportSelector"[\s\S]*\sonchange=/.test(html);
  const hasExternalReportScript = /<script\s+src="\/report\.js(?:\?[^"]*)?"\s*><\/script>/i.test(html);
  const changeBindingCount = (script.match(/addEventListener\((["'])change\1,\s*onReportSelectorChange\)/g) || []).length;
  const inputBindingCount = (script.match(/addEventListener\((["'])input\1,\s*onReportSelectorChange\)/g) || []).length;

  if (hasInlineOnChange) {
    fail("report selector should not use inline onchange binding");
  }
  if (!hasExternalReportScript) {
    fail("report.html must load public/report.js as an external script");
  }
  if (changeBindingCount !== 1) {
    fail(`report selector change handler binding count is ${changeBindingCount}, expected 1`);
  }
  if (inputBindingCount !== 1) {
    fail(`report selector input handler binding count is ${inputBindingCount}, expected 1`);
  }
}

function checkSearchPopoutDismiss() {
  const reportHtmlPath = resolve("public/report.html");
  const reportScriptPath = resolve("public/report.js");
  const html = readFileSync(reportHtmlPath, "utf8");
  const script = readFileSync(reportScriptPath, "utf8");
  const hasEscHandler = script.includes("event.key === 'Escape' && isSearchPopoutOpen()");
  const hasOutsideClick = script.includes("document.addEventListener('pointerdown', event =>");
  const hasCloseButton = html.includes("searchPopoutClose") && script.includes("searchPopoutClose");
  if (!hasEscHandler || !hasOutsideClick || !hasCloseButton) {
    fail("search popout dismiss handlers are incomplete");
  }
}

function checkEnvironmentFileSafety() {
  let trackedEnv = "";
  try {
    trackedEnv = run("git ls-files .env");
  } catch (error) {
    trackedEnv = "";
  }

  const trackedEnvInIndex = trackedEnv.split("\n").map((line) => line.trim()).includes(".env");
  const trackedEnvExistsLocally = trackedEnvInIndex && existsSync(resolve(".env"));

  if (trackedEnvExistsLocally) {
    fail(".env is tracked in git. Move secrets to .env.local and configure Vercel environment variables.");
  }

  if (!existsSync(resolve(".env.example"))) {
    fail(".env.example is missing. Add it with placeholder keys for local setup.");
  }
}

checkNodeSyntax();
checkReportSelectorBinding();
checkSearchPopoutDismiss();
checkEnvironmentFileSafety();

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("[lint] All checks passed.");
