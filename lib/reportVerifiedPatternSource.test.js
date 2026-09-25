import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");
const definitions = [
  { key: "action", label: "Typical Action Patterns", fallbackText: "Not detected in assigned PDF." },
  { key: "thinking", label: "Typical Thinking Patterns", fallbackText: "Not detected in assigned PDF." },
  { key: "feeling", label: "Typical Feeling Patterns", fallbackText: "Not detected in assigned PDF." },
];

function load() {
  const functions = ["resolveVerifiedCorePatternBullets", "normalizeCorePatternBullets"].map((name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing ${name}`);
    return source.slice(start, source.indexOf("\n}\n", start) + 2);
  });
  const context = vm.createContext({
    CORE_PATTERN_BULLET_DEFINITIONS: definitions,
    // Legacy cleanup intentionally changes damaged text; verified PDF wording
    // must bypass it through both assignment and subsequent render normalization.
    sanitizeCorePatternBulletText: (value) => typeof value === "string" ? value.replace(/\uFFFD/g, " ").trim() || null : null,
    console: { log() {} },
  });
  vm.runInContext(functions.join("\n"), context);
  return context;
}

const feeling = "While your exterior may be tough and no-nonsense, you feel emotions and are generous and kind-hearted.";
const feelingDetail = "You feel strongly about those close to you, and tend to express your love through sharing your protection and power.";
const joy = "You resonate with the positive side of the emotional landscape and others are likely to experience you as someone who expresses joy, optimism and enthusiasm.";
const diagnostics = (markdown) => ({ verification: { available: true, python: { available: true, markdown } } });
const fallback = definitions.map(({ key, label }) => ({ key, label, text: `${key} legacy source.` }));
const plain = (value) => JSON.parse(JSON.stringify(value));

test("verified layout markdown supplies intact source paragraphs bounded by headings and footers", () => {
  const { resolveVerifiedCorePatternBullets } = load();
  const markdown = `## **Worldview** Unrelated sidebar copy. ## **Typical Feeling Patterns:** - ${feeling} ${feelingDetail} - You may feel safe. 7 of 42 Copyright 2010-2022 Integrative Enneagram Solutions Client Name ## **Blind Spots** Unrelated later copy.`;
  const rows = resolveVerifiedCorePatternBullets({}, diagnostics(markdown), fallback);
  assert.equal(rows[2].text, `● ${feeling} ${feelingDetail} ● You may feel safe.`);
  assert.equal(rows[2].source, "verified_pdf_markdown");
  assert.deepEqual(plain(rows.slice(0, 2)), fallback.slice(0, 2));
  assert.doesNotMatch(rows[2].text, /sidebar|Blind Spots|Copyright|Client Name/);
});

test("all three source sections remain separate in flattened or multiline markdown", () => {
  const { resolveVerifiedCorePatternBullets } = load();
  for (const space of [" ", "\n\n"]) {
    const markdown = [`## **Typical Action Patterns:**${space}- You act carefully.`, `## Typical Thinking Patterns:${space}- You consider the options.`, `## **Typical Feeling Patterns:**${space}- ${joy}`, "## **Core Fear** Other text."].join(space);
    const rows = resolveVerifiedCorePatternBullets({}, diagnostics(markdown), fallback);
    assert.deepEqual(plain(rows.map((row) => row.text)), ["● You act carefully.", "● You consider the options.", `● ${joy}`]);
  }
});

test("embedded selected-report diagnostics supply source when API diagnostics omit markdown", () => {
  const { resolveVerifiedCorePatternBullets } = load();
  const profile = { _parseDiagnostics: diagnostics(`## **Typical Feeling Patterns:** - ${joy} ## **Blind Spots** Stop here.`) };
  assert.equal(resolveVerifiedCorePatternBullets(profile, {}, fallback)[2].text, `● ${joy}`);
  assert.equal(resolveVerifiedCorePatternBullets(profile, diagnostics(""), fallback)[2].text, `● ${joy}`);
});

test("missing or explicitly unavailable source keeps current report fallback without inventing copy", () => {
  const { resolveVerifiedCorePatternBullets } = load();
  const unavailable = diagnostics(`## **Typical Feeling Patterns:** - ${joy}`);
  unavailable.verification.python.available = false;
  for (const metadata of [{}, diagnostics(""), diagnostics("## **Blind Spots** Other source."), unavailable]) {
    assert.deepEqual(plain(resolveVerifiedCorePatternBullets({}, metadata, fallback)), fallback);
  }
  assert.deepEqual(plain(resolveVerifiedCorePatternBullets({}, {}, [])), []);
});

test("verified wording remains verbatim through repeated report normalization", () => {
  const { resolveVerifiedCorePatternBullets, normalizeCorePatternBullets } = load();
  const sentence = "A\uFFFDer having expressed yourself, you may move on. your response may vary.";
  const rows = resolveVerifiedCorePatternBullets({}, diagnostics(`## **Typical Feeling Patterns:** - ${sentence}`), fallback);
  const normalized = normalizeCorePatternBullets(normalizeCorePatternBullets(rows));
  assert.equal(normalized[2].text, `● ${sentence}`);
  assert.equal(normalized[2].source, "verified_pdf_markdown");
});

test("internal dashes stay inside their source sentence", () => {
  const { resolveVerifiedCorePatternBullets } = load();
  const sentence = "You repeat a reminder - Your pace can vary - when you need time.";
  const rows = resolveVerifiedCorePatternBullets({}, diagnostics(`## **Typical Feeling Patterns:** - ${sentence} - You can ask for support.`), fallback);
  assert.equal(rows[2].text, `● ${sentence} ● You can ask for support.`);
});

test("A to B to A uses each report's own markdown without changing stored profiles", () => {
  const { resolveVerifiedCorePatternBullets } = load();
  const a = { _parseDiagnostics: diagnostics(`## **Typical Feeling Patterns:** - ${feeling}`) };
  const b = { _parseDiagnostics: diagnostics(`## **Typical Feeling Patterns:** - ${joy}`) };
  const original = JSON.stringify([a, b, fallback]);
  const firstA = plain(resolveVerifiedCorePatternBullets(a, {}, fallback));
  const firstB = plain(resolveVerifiedCorePatternBullets(b, {}, fallback));
  assert.notEqual(firstA[2].text, firstB[2].text);
  assert.deepEqual(plain(resolveVerifiedCorePatternBullets(a, {}, fallback)), firstA);
  assert.equal(JSON.stringify([a, b, fallback]), original);
});

test("normal and fallback ingestion prefer source, with a final override after cleanup", () => {
  const fallbackStart = source.indexOf("function applyFallbackAssignedReportFromServerData(");
  const ingestStart = source.indexOf("async function ingestAssignedReportIntoDashboard(");
  const cleanupStart = source.indexOf("const narrativeCleanupPayload = await hydrateDashboardNarrativesWithLlmCleanup(");
  const finalApply = source.indexOf("applyAssignedPdfReport({", cleanupStart);
  for (const [name, index] of Object.entries({ fallbackStart, ingestStart, cleanupStart, finalApply })) {
    assert.ok(index >= 0, `Missing integration anchor: ${name}`);
  }
  const selection = /resolveVerifiedCorePatternBullets\(parsedProfile,\s*(?:data\?\.)?parseDiagnostics,/;
  assert.match(source.slice(fallbackStart, ingestStart), selection);
  assert.match(source.slice(ingestStart, cleanupStart), selection);
  assert.match(source.slice(cleanupStart, finalApply), selection);
});
