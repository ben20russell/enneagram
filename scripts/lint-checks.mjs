import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  const reportPath = resolve("public/report.html");
  const text = readFileSync(reportPath, "utf8");
  const hasInlineOnChange = /id="reportSelector"[\s\S]*\sonchange=/.test(text);
  const changeBindingCount = (text.match(/addEventListener\((["'])change\1,\s*onReportSelectorChange\)/g) || []).length;
  const inputBindingCount = (text.match(/addEventListener\((["'])input\1,\s*onReportSelectorChange\)/g) || []).length;

  if (hasInlineOnChange) {
    fail("report selector should not use inline onchange binding");
  }
  if (changeBindingCount !== 1) {
    fail(`report selector change handler binding count is ${changeBindingCount}, expected 1`);
  }
  if (inputBindingCount !== 1) {
    fail(`report selector input handler binding count is ${inputBindingCount}, expected 1`);
  }
}

function checkSearchPopoutDismiss() {
  const reportPath = resolve("public/report.html");
  const text = readFileSync(reportPath, "utf8");
  const hasEscHandler = text.includes("event.key === 'Escape' && isSearchPopoutOpen()");
  const hasOutsideClick = text.includes("document.addEventListener('pointerdown', event =>");
  const hasCloseButton = text.includes("searchPopoutClose");
  if (!hasEscHandler || !hasOutsideClick || !hasCloseButton) {
    fail("search popout dismiss handlers are incomplete");
  }
}

checkNodeSyntax();
checkReportSelectorBinding();
checkSearchPopoutDismiss();

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("[lint] All checks passed.");
