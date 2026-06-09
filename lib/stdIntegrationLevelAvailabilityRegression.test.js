import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");
const routePath = path.join(process.cwd(), "app", "api", "admin-review", "route.js");
const reportHtmlPath = path.join(process.cwd(), "public", "report.html");
const reportJsPath = path.join(process.cwd(), "public", "report.js");

function read(filePath) {
  return readFileSync(filePath, "utf8");
}

test("admin review panel conditionally hides integration-level grading for STD reports", () => {
  const source = read(panelPath);

  assert.match(
    source,
    /const\s+supportsIntegrationLevel\s*=\s*selected\?\.coreIdentity\?\.supportsIntegrationLevel\s*!==\s*false/,
    "Expected admin review panel to derive integration-level availability from selected report core identity metadata.",
  );

  assert.match(
    source,
    /integrationLevel:\s*supportsIntegrationLevel\s*\?\s*String\(coreIdentity\?\.integrationLevel/,
    "Expected admin review payload to send null integrationLevel when STD reports do not support this field.",
  );

  assert.match(
    source,
    /data-testid="admin-review-core-integration-level-unavailable"[\s\S]*Integration Level is not available for STD reports\./,
    "Expected admin review panel to show an STD-specific integration-level guidance note.",
  );
});

test("admin review route nulls integration-level values for STD reports and exposes support metadata", () => {
  const source = read(routePath);

  assert.match(
    source,
    /supportsIntegrationLevelForReport/,
    "Expected admin-review route to resolve whether integration-level grading is supported per report type.",
  );

  assert.match(
    source,
    /supportsIntegrationLevel,/,
    "Expected admin-review queue payload to expose integration-level support metadata to the UI.",
  );

  assert.match(
    source,
    /integrationLevel:\s*supportsIntegrationLevel\s*\?\s*\(/,
    "Expected admin-review save flow to persist integration level only when report type supports it.",
  );
});

test("dashboard rendering hides integration UI for reports that do not support integration level", () => {
  const htmlSource = read(reportHtmlPath);
  const jsSource = read(reportJsPath);

  assert.match(
    htmlSource,
    /id="integrationValueRow"/,
    "Expected overview Integration Level row to expose a dedicated id for conditional visibility.",
  );

  assert.match(
    jsSource,
    /function\s+setIntegrationUiVisibility\s*\(/,
    "Expected dashboard script to define a reusable integration-visibility toggler.",
  );

  assert.match(
    jsSource,
    /const\s+supportsIntegrationLevel\s*=\s*REPORT\?\.supportsIntegrationLevel\s*!==\s*false/,
    "Expected report render flow to read integration-level support from hydrated report state.",
  );

  assert.match(
    jsSource,
    /setIntegrationUiVisibility\(\s*supportsIntegrationLevel\s*\)/,
    "Expected report render flow to hide integration UI when integration level is unavailable.",
  );
});
