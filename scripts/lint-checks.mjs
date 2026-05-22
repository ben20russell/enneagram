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
  const hasInlineSelectorChange = text.includes(
    'id="reportSelector" data-testid="report-selector" onchange="onReportSelectorChange({ target: this })"',
  );
  const hasJsSelectorBinding = text.includes(
    "addEventListener('change', onReportSelectorChange)",
  );

  if (!hasInlineSelectorChange) {
    fail("report selector is missing inline onchange binding");
  }
  if (hasJsSelectorBinding) {
    fail("duplicate report selector JS change binding still present");
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
