import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");

function loadComponent() {
  const names = [
    "stripPdfFooterNoiseFragments", "normalizeExtractedText", "sanitizeSnippet",
    "cleanPdfExtractedValue", "isMissingExtractedText", "formatOptionalText", "escapeHtml", "ensureSentenceStartsCapitalized",
    "buildAdaptiveListHtml", "normalizeCriticalConflictRows", "selectCriticalConflictPatterns",
    "renderCriticalConflictPatterns", "setHtml", "normalizeDashboardHtmlCopy",
  ];
  const functions = names.map((name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing ${name}`);
    const next = source.indexOf("\nfunction ", start + 1);
    return source.slice(start, next < 0 ? undefined : next);
  });
  const html = {};
  const context = vm.createContext({
    console: { log() {} },
    document: { getElementById: (id) => ({ set innerHTML(value) { html[id] = value; } }) },
  });
  vm.runInContext(`${functions.join("\n")}\nthis.select = selectCriticalConflictPatterns; this.render = renderCriticalConflictPatterns;`, context);
  return { ...context, html };
}

const anger = "Strong feelings of anger that leads to action in some shape or form";
const vulnerability = "When vulnerable, you may choose to withdraw from the situation entirely or consult with individuals whose opinions you value and trust, using them as sounding boards";
const impact = "Your response may seem quite intimidating and aggressive to others, even if this is not the case";
const reaction = "You are likely to actively share your thoughts and feelings with others and, in conflict situations this may take the form of strong, even explosive reactions";
const feelings = "You will tend to first want to express your emotions before moving on in the relationships";

function report(typeNumber, triggered, response = reaction) {
  return { typeNumber: String(typeNumber), spreadsheetFocuses: {
    conflictResponseCopy: response, conflictTriggeredBullets: triggered,
  } };
}

test("conflict card selects two responses and three distinct critical triggered patterns", () => {
  const { select } = loadComponent();
  const result = select(report(8, [
    "Your reaction is likely to be strongly driven by an instinctive and even physical response",
    anger, vulnerability, "You may be quite dismissive of individuals who have slighted you", impact,
    'When sharing your thoughts on matters you will state your opinions in a "take it or leave it fashion"',
    "You are likely to be quite energised if the conversation gets to the point where people are being completely honest and truthful with each other",
  ], `${reaction}. ${feelings}. You may deny that you need support and understanding from others in this process.`));
  assert.equal(result.responses.length, 2);
  assert.equal(result.triggered.length, 3);
  assert.ok(result.triggered.includes(anger), "Prefer the concrete anger/action pattern over a generic physical reaction");
  assert.ok(result.triggered.includes(vulnerability));
  assert.ok(result.triggered.includes(impact));
});

test("heading fragments, truncations, development advice, and duplicates do not fill priorities", () => {
  const { select } = loadComponent();
  const result = select(report(8, [
    "What you do when triggered", "When vulnerable, y...", "Your response may seem quite i…",
    "Development goals", "Practise pausing before expressing your anger.",
    "You should learn to acknowledge your vulnerability.", "Not detected in assigned PDF.",
    anger, anger.toLowerCase(), `${anger}.`, vulnerability, impact,
    `${anger} ${vulnerability} ${impact}`,
  ]));
  assert.equal(result.triggered.length, 3);
  assert.deepEqual(new Set(Array.from(result.triggered)), new Set([anger, vulnerability, impact]));
});

test("critical patterns late in the source list remain eligible", () => {
  const { select } = loadComponent();
  const result = select(report(8, [
    ...Array.from({ length: 25 }, (_, index) => `Review development goal number ${index} and practise self-awareness.`),
    anger, vulnerability, impact,
  ]));
  assert.equal(result.triggered.length, 3);
  assert.ok(result.triggered.includes(vulnerability));
});

test("inline bundles split into complete statements without losing conditional context", () => {
  const { select } = loadComponent();
  const result = select(report(8, [`${anger} ● ${vulnerability} ● ${impact}`]));
  assert.deepEqual(new Set(Array.from(result.triggered)), new Set([anger, vulnerability, impact]));
  assert.ok(result.triggered.includes(vulnerability), "Keep the full statement, even beyond 210 characters");
});

test("wrapped PDF bullets preserve whole sentences and exclude conflict-section introductions", () => {
  const { select } = loadComponent();
  const active = report(8, [`● ${anger}\n● ${vulnerability.replace("whose opinions", "whose\nopinions")}\n● ${impact}`],
    `When conflict erupts and you are not in a position to avoid it any longer, your Ennea style is likely to lead to the following reactions and behaviours:\n● ${reaction.replace("take the form", "take\nthe form")}\n● ${feelings}\nYour preferred conflict processing strategy is reactive.`);
  const result = select(active);
  assert.ok(result.responses.includes(reaction));
  assert.doesNotMatch(result.responses.join(" "), /following reactions|preferred conflict processing/);
  assert.ok(result.triggered.includes(vulnerability));
  assert.ok(result.triggered.every((row) => !/whose$/.test(row)));
});

test("source wording remains intact when PDF ligatures and words resemble OCR spacing", () => {
  const { select, render, html } = loadComponent();
  const sourceText = "You are likely to look to others for support and understanding but may behave in a way that makes it diﬀicult for others to satisfy this need";
  const result = select(report(4, [sourceText]));
  assert.equal(result.triggered[0], sourceText.normalize("NFKC"));
  render(report(4, [sourceText]));
  assert.ok(html.conflictTriggeredCopy.includes(sourceText.normalize("NFKC")));
});

test("growth instructions with conflict keywords never become triggered behavior", () => {
  const { select } = loadComponent();
  const result = select(report(8, [
    "Become aware of your instinctive response to conflict.",
    "Pay attention to anger before acting on it.",
    "You need to let go of your desire to control others.",
    anger, vulnerability, impact,
  ]));
  assert.deepEqual(new Set(Array.from(result.triggered)), new Set([anger, vulnerability, impact]));
});

test("all nine types prioritize their characteristic pattern over unrelated context", () => {
  const { select } = loadComponent();
  const patterns = [
    "You become critical and rigid when others fail to meet your standards.",
    "You neglect your own needs while seeking appreciation from others.",
    "You suppress your feelings and focus on performance and efficiency.",
    "You intensify your emotions and dwell on feeling misunderstood.",
    "You withdraw from others and detach into analysis and concepts.",
    "You become doubtful and defensive while seeking reassurance and guidance.",
    "You reframe problems positively and escape painful feelings through distraction.",
    anger,
    "You avoid conflict by accommodating others and suppressing your anger.",
  ];
  patterns.forEach((pattern, index) => {
    const result = select(report(index + 1, ["You consider the details of the current situation carefully.", pattern]));
    assert.equal(result.triggered[0], pattern, `Type ${index + 1}`);
  });
});

test("selection uses each report's actual text rather than supplying type defaults", () => {
  const { select } = loadComponent();
  const a = report(8, [anger]);
  const b = report(8, [vulnerability]);
  const original = JSON.stringify([a, b]);
  assert.deepEqual(Array.from(select(a).triggered), [anger]);
  assert.deepEqual(Array.from(select(b).triggered), [vulnerability]);
  assert.equal(JSON.stringify([a, b]), original);
});

test("duplicate response sentences do not reappear as triggered patterns", () => {
  const { select } = loadComponent();
  const result = select(report(8, [reaction, vulnerability, impact], reaction));
  assert.ok(!result.triggered.includes(reaction));
  assert.ok(result.triggered.includes(vulnerability));
});

test("complete fallback text is considered when bullet entries are missing or truncated", () => {
  const { select } = loadComponent();
  const active = report(8, ["When vulnerable, y...", "Your response may seem quite i..."]);
  active.spreadsheetFocuses.conflictTriggeredCopy = `${vulnerability}. ${impact}.`;
  const result = select(active);
  assert.equal(result.triggered.length, 2);
  assert.match(result.triggered.join(" "), /When vulnerable, you may choose to withdraw/);
  assert.doesNotMatch(result.triggered.join(" "), /\.\.\./);
});

test("rendering A to B to A refreshes both lists and does not retain stale patterns", () => {
  const { render, html } = loadComponent();
  const a = report(8, [anger, vulnerability, impact], `${reaction}. ${feelings}.`);
  const b = report(9, ["You avoid conflict by accommodating others and suppressing your anger."],
    "You focus on maintaining harmony and avoid acknowledging painful problems.");
  render(a);
  const first = { ...html };
  render(b);
  for (const id of ["conflictResponseCopy", "conflictTriggeredCopy"]) assert.notEqual(html[id], first[id]);
  assert.doesNotMatch(html.conflictTriggeredCopy, /intimidating|sounding boards/);
  render(a);
  assert.deepEqual(html, first);
});

test("empty and malformed reports show recovery guidance instead of invented patterns", () => {
  const { select, render, html } = loadComponent();
  for (const active of [null, {}, report(8, []), { spreadsheetFocuses: { conflictTriggeredBullets: [null, {}, 42] } }]) {
    assert.equal(select(active).triggered.length, 0);
    render(active);
    assert.match(html.conflictTriggeredCopy, /Refresh.*administrator/);
    assert.doesNotMatch(html.conflictTriggeredCopy, /intimidating|anger/);
  }
});

test("rendered lists have test IDs and safely escape source text", () => {
  const { render, html } = loadComponent();
  render(report(8, [`${anger} <script>alert('test')</script>`]));
  assert.match(html.conflictTriggeredCopy, /data-testid="critical-triggered-patterns"/);
  assert.doesNotMatch(html.conflictTriggeredCopy, /<script>/);
});
