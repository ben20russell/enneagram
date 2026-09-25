import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");

function loadComponent() {
  const names = [
    "stripPdfFooterNoiseFragments", "normalizeExtractedText", "sanitizeSnippet",
    "cleanPdfExtractedValue", "isMissingExtractedText", "isLikelyGarbledDevelopmentExerciseText",
    "ensureSentenceStartsCapitalized", "formatOptionalText", "escapeHtml",
    "normalizeIntegrationLevel", "getLevelVisualScore", "toFiniteScoreOrNull", "scoreBandLabel",
    "normalizeCriticalDevelopmentExerciseText",
    "normalizeDevelopmentExerciseGridItems", "buildDevExercisePathHtml",
    "selectCriticalDevelopmentExercises", "buildDevExerciseComponentData",
    "renderDevelopmentExerciseGridItems",
    "normalizeDashboardHtmlCopy", "setHtml",
    "getTargetedSections", "normalizeTargetedSectionRows", "compactInsightSnippet",
    "extractDevelopmentExercisesFromTargetedSections",
  ];
  const functions = names.flatMap((name) => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) return [];
    const next = source.indexOf("\nfunction ", start + 1);
    return [source.slice(start, next < 0 ? undefined : next)];
  });
  const context = vm.createContext({ console: { log() {} } });
  vm.runInContext(`${functions.join("\n")}\nthis.component = buildDevExerciseComponentData; this.render = renderDevelopmentExerciseGridItems;`, context);
  return context;
}

const rows = (texts) => texts.map((text) => ({ text }));
const textList = (result) => Array.from(result.paths, (row) => row.text);
const vulnerability = "Explore the vulnerability that your toughness and anger protect, and consider the cost to yourself and others.";
const needs = "Identify your personal needs and practise caring for yourself as considerately as you care for others.";
const recovery = "Protect your physical well-being through rest and recovery instead of exhausting yourself.";
const awareness = "Practise self-observation and pause before reacting to your feelings.";

test("critical exercises come from the report and exclude descriptive wing material", () => {
  const { component } = loadComponent();
  const exercises = rows([
    "The Type 7 wing can bring optimism and enthusiasm at high integration.",
    "At low integration, the Type 9 wing may contribute to disengagement.",
    vulnerability,
    "Share power and create opportunities for collaboration rather than acting unilaterally.",
    awareness,
    "Examine revenge and grudges, and develop your capacity for forgiveness.",
  ]);
  const result = component({ typeNumber: "8", integration: "Low", developmentExercises: exercises });
  assert.ok(result.paths.length > 0 && result.paths.length <= 3);
  assert.ok(textList(result).includes(vulnerability));
  for (const text of textList(result)) {
    assert.ok(exercises.some((row) => row.text === text));
    assert.doesNotMatch(text, /wing|At low integration/i);
  }
});

test("priority selection uses the whole report, including critical exercises after extraction caps", () => {
  const { component } = loadComponent();
  const initial = rows(["Reflect on your weekly goals and review your progress."]);
  const result = component({
    typeNumber: "2", integration: "Moderate", strainScoresRaw: { physical: "High" },
    developmentExercises: initial,
    developmentExerciseCandidates: [...initial, ...rows(Array(25).fill("The wing describes a possible influence on your style.")), ...rows([needs, recovery])],
  });
  assert.equal(result.paths[0]?.text, recovery);
  assert.ok(textList(result).includes(needs));
});

test("switching types recomputes priorities without mutating report data", () => {
  const { component } = loadComponent();
  const developmentExercises = rows([needs, vulnerability, awareness, recovery]);
  const original = JSON.stringify(developmentExercises);
  const a = { typeNumber: "8", integration: "High", developmentExercises };
  const b = { typeNumber: "2", integration: "High", developmentExercises };
  assert.equal(component(a).paths[0]?.text, vulnerability);
  assert.equal(component(b).paths[0]?.text, needs);
  assert.equal(component(a).paths[0]?.text, vulnerability);
  assert.equal(JSON.stringify(developmentExercises), original);
});

test("low integration prioritizes self-observation using existing report exercises", () => {
  const { component } = loadComponent();
  const base = { typeNumber: "8", developmentExercises: rows([vulnerability, awareness]) };
  assert.equal(component({ ...base, integration: "Low" }).paths[0]?.text, awareness);
  assert.equal(component({ ...base, integration: "High" }).paths[0]?.text, vulnerability);
});

test("missing and unsupported signals do not imply low integration or high strain", () => {
  const { component } = loadComponent();
  const base = { typeNumber: "8", developmentExercises: rows([vulnerability, recovery, awareness]) };
  assert.equal(component(base).paths[0]?.text, vulnerability);
  const result = component({ ...base, reportType: "STD", supportsIntegrationLevel: false, supportsStrainProfile: false, integration: "Low", strainScoresRaw: { overall: 90 } });
  assert.equal(result.paths[0]?.text, vulnerability);
  assert.doesNotMatch(result.summary, /LOW|MEDIUM|HIGH|unavailable/i);
});

test("high happiness is not mistaken for high strain", () => {
  const { component } = loadComponent();
  const base = { typeNumber: "8", developmentExercises: rows([vulnerability, recovery]) };
  assert.equal(component({ ...base, strainScoresRaw: { happiness: "High" } }).paths[0]?.text, vulnerability);
  assert.equal(component({ ...base, strainScoresRaw: { happiness: "Low" } }).paths[0]?.text, recovery);
});

test("high physical strain prioritizes physical recovery over general well-being advice", () => {
  const { component } = loadComponent();
  const result = component({ typeNumber: "2", strainScoresRaw: { physical: "High" }, developmentExercises: rows([
    "Take responsibility for your happiness, security, well-being and success.",
    "Develop bodily awareness through practices such as massage, resistance training, horseback riding or dancing.",
    needs,
    "Invest in your own health and wellbeing rather than exhausting yourself in service of others.",
  ]) });
  assert.match(result.paths[0]?.text, /^Invest in your own health/);
});

test("duplicate exercises and empty placeholders never fill the priority list", () => {
  const { component } = loadComponent();
  const result = component({ typeNumber: "8", developmentExercises: rows([
    vulnerability, vulnerability.toLowerCase(), "Not detected in assigned PDF.",
    "Copyright 2010-2022 Integrative Enneagram Solutions Client 7 of 42",
  ]) });
  assert.deepEqual(textList(result), [vulnerability]);
  assert.match(result.summary, /1 priority/);
});

test("empty exercise state offers recovery guidance and no invented exercise cards", () => {
  const { component, render } = loadComponent();
  const result = component({ typeNumber: "8", developmentExercises: [] });
  assert.equal(result.paths.length, 0);
  const html = render(result.paths);
  assert.match(html, /no development exercises|no exercises/i);
  assert.match(html, /refresh|contact/i);
  assert.doesNotMatch(html, /Exercise 1|Integration Stabilizer|Applied Leadership Loop/);
});

test("rendered priorities have test IDs and preserve escaped report text", () => {
  const { component, render } = loadComponent();
  const report = { typeNumber: "2", developmentExercises: rows([`${needs} Notice <b>your feelings</b>.`]) };
  const result = component(report);
  const html = render(result.paths);
  assert.match(html, /data-testid="development-exercise-1"/);
  assert.doesNotMatch(html, /<b>your feelings<\/b>/);
});

test("all nine types prioritize their core growth work over general planning", () => {
  const { component } = loadComponent();
  const priorities = [
    "Practise self-compassion when your inner critic demands perfection.",
    needs,
    "Explore authenticity and honesty beyond achievement and performance.",
    "Reduce comparison and shame through self-acceptance.",
    "Build connection by participating rather than withdrawing into isolation.",
    "Practise trusting your inner authority when seeking certainty.",
    "Explore how you avoid pain through distraction and escape.",
    vulnerability,
    "Express your own needs and priorities clearly to others.",
  ];
  priorities.forEach((text, index) => {
    const result = component({ typeNumber: String(index + 1), integration: "High", developmentExercises: rows([
      "Reflect on your weekly goals and review your progress.", text,
    ]) });
    assert.equal(result.paths[0]?.text, text, `Type ${index + 1}`);
  });
});

test("three priorities cover distinct needs when an exercise spans two themes", () => {
  const { component } = loadComponent();
  const present = "Notice when impulsiveness protects you from vulnerability, and practise remaining present with those feelings.";
  const forgiveness = "Examine revenge and grudges, and develop your capacity for forgiveness.";
  const collaboration = "Share power and create opportunities for collaboration rather than acting unilaterally.";
  const result = component({ typeNumber: "8", integration: "Low", developmentExercises: rows([
    present, vulnerability, forgiveness, collaboration,
  ]) });
  assert.deepEqual(textList(result), [present, forgiveness, collaboration]);
});

test("Type 7 focus prioritizes following through over a substring in generic body guidance", () => {
  const { component } = loadComponent();
  const commitment = "Complete important tasks and commitments before pursuing another experience.";
  const result = component({ typeNumber: "7", developmentExercises: rows([
    "Distinguish grounded, alive action from unfocused, impulsive activity.", commitment,
  ]) });
  assert.equal(result.paths[0]?.text, commitment);
});

test("an imported bundle cannot bypass the exercise limit or displace its individual exercises", () => {
  const { component } = loadComponent();
  const exercises = [
    "Set priorities and commit to completing two tasks you have been putting off.",
    "Practise expressing your needs and wishes clearly and unequivocally.",
    "Recognise conflict as a natural and healthy part of life rather than automatically avoiding it.",
    "Practice mindfulness to distinguish a quiet, spacious mind from busy mental chatter.",
  ];
  const bundle = exercises.join(" ");
  const result = component({ typeNumber: "9", developmentExercises: rows([bundle]), developmentExerciseCandidates: rows(exercises) });
  assert.equal(result.paths.length, 3);
  assert.ok(!textList(result).includes(bundle));
  for (const text of textList(result)) assert.ok(exercises.includes(text));
});

test("complete source exercises displace clipped equivalents and ellipses never fill a priority", () => {
  const { component, render } = loadComponent();
  const truncated = [
    vulnerability.slice(0, 90) + "...",
    vulnerability.slice(0, 80) + "…",
    "Explore the vulnerability that your toughness and anger protect... Reflect on your reactions.",
  ];
  const result = component({
    typeNumber: "8",
    developmentExercises: rows(truncated),
    developmentExerciseCandidates: rows([vulnerability]),
  });
  assert.deepEqual(textList(result), [vulnerability]);
  assert.ok(render(result.paths).includes(vulnerability));
  const missing = component({ typeNumber: "8", developmentExercises: rows(truncated) });
  assert.equal(missing.paths.length, 0);
  assert.match(render(missing.paths), /Refresh.*administrator/);
});

test("targeted exercise extraction preserves long and late source priorities without a 420-character cutoff", () => {
  const { component, render, extractDevelopmentExercisesFromTargetedSections } = loadComponent();
  const full = vulnerability + " Notice when your efforts to stay strong prevent you from acknowledging what you need. " +
    "Reflect on the effect that this has on your relationships and your capacity to receive support. " +
    "Identify one person with whom you feel safe enough to discuss a difficult experience openly. " +
    "Share what you felt in that situation and what would have helped you, then listen to their perspective. " +
    "Take time afterwards to observe how it felt to let another person see this part of your experience.";
  assert.ok(full.length > 420);
  const earlier = Array.from({ length: 10 }, (_, index) => "Reflect on general weekly goal number " + (index + 1) + " and review your progress.");
  const sourceRows = extractDevelopmentExercisesFromTargetedSections({
    targetedSections: { development_exercises: { core_type: [...earlier, full] } },
  });
  assert.ok(sourceRows.some((row) => row.text === full));
  const result = component({
    typeNumber: "8",
    developmentExercises: rows([full.slice(0, 420) + "..."]),
    developmentExerciseCandidates: sourceRows,
  });
  assert.equal(result.paths[0]?.text, full);
  assert.ok(render(result.paths).includes("let another person see this part of your experience."));
});

test("actual center exercises preserve source words and abbreviation case through selection and rendering", () => {
  const { component, render } = loadComponent();
  const examples = [
    {
      type: "8",
      source: "Build self-awareness regarding the distinction between action energy that is grounded and alivevs. action energy that is unfocused and impulsive.",
      expected: "Build self-awareness regarding the distinction between action energy that is grounded and alive vs. action energy that is unfocused and impulsive.",
    },
    {
      type: "4",
      source: "Build self-awareness regarding the distinction between feeling energy that is receptive and authentic vs. feeling energy that is reactive and oversensitive.",
      expected: "Build self-awareness regarding the distinction between feeling energy that is receptive and authentic vs. feeling energy that is reactive and oversensitive.",
    },
  ];
  for (const example of examples) {
    const result = component({ typeNumber: example.type, integration: "Low", developmentExercises: rows([example.source]) });
    assert.deepEqual(textList(result), [example.expected]);
    const html = render(result.paths);
    assert.ok(html.includes(example.expected));
    assert.doesNotMatch(html, /a live|vs\. (?:Action|Feeling)|<\/li><li>action energy/);
  }
});

test("original exercise candidates take precedence over legacy cleanup of the same source sentence", () => {
  const { component, render } = loadComponent();
  const original = "Build self-awareness regarding the distinction between feeling energy that is receptive and authentic vs. feeling energy that is reactive and oversensitive.";
  const cleaned = original.replace("vs. feeling", "vs. Feeling");
  const result = component({
    typeNumber: "4",
    integration: "Low",
    developmentExercises: rows([cleaned]),
    developmentExerciseCandidates: rows([original]),
  });
  assert.deepEqual(textList(result), [original]);
  assert.ok(render(result.paths).includes(original));
});

test("mounting source exercise HTML preserves wording without applying legacy sentence cleanup again", () => {
  const context = loadComponent();
  const node = { innerHTML: "" };
  context.document = { getElementById: () => node };
  const original = "Build self-awareness regarding the distinction between feeling energy that is receptive and authentic vs. feeling energy that is reactive and oversensitive.";
  const paths = context.component({ typeNumber: "4", integration: "Low", developmentExercises: rows([original]) }).paths;
  context.setHtml("devExercisePaths", context.render(paths), { preserveSourceCopy: true });
  assert.ok(node.innerHTML.includes(original));
  assert.doesNotMatch(node.innerHTML, /vs\. Feeling/);
  assert.match(source, /setHtml\(\s*'devExercisePaths',\s*renderDevelopmentExerciseGridItems\(devExerciseComponentData\.paths\),\s*\{\s*preserveSourceCopy:\s*true\s*\}/);
});
