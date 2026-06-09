import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelPath = path.join(process.cwd(), "app", "admin-review", "AdminReviewPanel.jsx");
const routePath = path.join(process.cwd(), "app", "api", "admin-review", "route.js");

function readPanel() {
  return readFileSync(panelPath, "utf8");
}

function readRoute() {
  return readFileSync(routePath, "utf8");
}

test("admin review panel exposes core identity grading controls and submits them", () => {
  const source = readPanel();

  assert.match(
    source,
    /data-testid="admin-review-core-main-type-name"/,
    "Expected admin review panel to expose a core-identity main type name field.",
  );
  assert.match(
    source,
    /data-testid="admin-review-core-dominant-instinct"/,
    "Expected admin review panel to expose a core-identity dominant instinct field.",
  );
  assert.doesNotMatch(
    source,
    /data-testid="admin-review-core-subtype-keyword"/,
    "Expected subtype keyword input to be removed from admin review core identity controls.",
  );
  assert.match(
    source,
    /data-testid="admin-review-core-integration-level"/,
    "Expected admin review panel to expose a core-identity integration level field.",
  );
  assert.match(
    source,
    /data-testid="admin-review-core-stretch-point"/,
    "Expected admin review panel to expose a core-identity stretch point field.",
  );
  assert.match(
    source,
    /data-testid="admin-review-core-release-point"/,
    "Expected admin review panel to expose a core-identity release point field.",
  );
  assert.match(
    source,
    /<select[\s\S]*?data-testid="admin-review-core-main-type-name"/,
    "Expected core main type name control to be a dropdown.",
  );
  assert.match(source, /Strict Perfectionist/, "Expected main type dropdown option for Type 1.");
  assert.match(source, /Considerate Helper/, "Expected main type dropdown option for Type 2.");
  assert.match(source, /Competitive Achiever/, "Expected main type dropdown option for Type 3.");
  assert.match(source, /Intense Creative/, "Expected main type dropdown option for Type 4.");
  assert.match(source, /Quiet Specialist/, "Expected main type dropdown option for Type 5.");
  assert.match(source, /Loyal Sceptic/, "Expected main type dropdown option for Type 6.");
  assert.match(source, /Enthusiastic Visionary/, "Expected main type dropdown option for Type 7.");
  assert.match(source, /Active Controller/, "Expected main type dropdown option for Type 8.");
  assert.match(source, /Adaptive Peacemaker/, "Expected main type dropdown option for Type 9.");

  assert.match(
    source,
    /const\s+payload\s*=\s*\{[\s\S]*coreIdentity:\s*\{[\s\S]*\}\s*,[\s\S]*scores:/s,
    "Expected admin review save payload to include graded core identity values.",
  );
});

test("admin review save persists graded core identity and records ML ground-truth identity labels", () => {
  const source = readRoute();

  assert.match(
    source,
    /const\s+coreIdentityInput\s*=\s*normalizeCoreIdentityPayload\(\s*body\?\.coreIdentity\s*\)/,
    "Expected admin review route to normalize submitted core identity payload.",
  );

  assert.match(
    source,
    /parsedProfile:\s*\{[\s\S]*typeName:[\s\S]*instinctualVariant:[\s\S]*subtypeKeyword:[\s\S]*integrationLevel:[\s\S]*connectedLineA:[\s\S]*connectedLineB:/s,
    "Expected admin review route to persist graded core identity fields into parsedProfile.",
  );

  assert.match(
    source,
    /dashboardContext:\s*\{[\s\S]*instinct:[\s\S]*integrationLevel:/s,
    "Expected admin review route to keep dashboard context instinct/integration in sync with graded identity.",
  );

  assert.match(
    source,
    /groundTruthIdentity:\s*\{[\s\S]*primaryType:[\s\S]*instinctualVariant:[\s\S]*integrationLevel:[\s\S]*subtypeKeyword:[\s\S]*stretchPoint:[\s\S]*releasePoint:[\s\S]*typeName:/s,
    "Expected admin review ML feedback payload to capture graded core identity labels.",
  );
});
