import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");

function loadComponent(intl = Intl) {
  const names = ["summarizeReportPassage", "renderReportPassage", "resolveCenterPatternItems", "renderCenterPatternRows", "escapeHtml"];
  const functions = names.map((name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing ${name}`);
    return source.slice(start, source.indexOf("\n}\n", start) + 2);
  });
  const context = vm.createContext({ Intl: intl, console: { log() {} } });
  vm.runInContext(functions.join("\n"), context);
  return context;
}

const opening = "Acting from your gut instinct to make things happen is second nature to you.";
const qualification = "You may feel that any action is better than doing nothing at all.";
const detail = "You project yourself as direct and intense in the way you speak, choice of words and body language.";
const longAction = `${opening} ${qualification} ${detail}`;

test("long passages use complete source sentences without inventing or clipping words", () => {
  const { summarizeReportPassage } = loadComponent();
  const summary = summarizeReportPassage(longAction);
  assert.equal(summary, `${opening} ${qualification}`);
  assert.ok(longAction.includes(summary));
  assert.ok(summary.split(/\s+/).length <= 40);
  assert.doesNotMatch(summary, /…|\.\.\./);
});

test("short passages preserve wording, qualifiers, negation, and conditional context", () => {
  const { summarizeReportPassage } = loadComponent();
  const text = "When you feel safe, you may share your feelings. You do not always express anger.";
  assert.equal(summarizeReportPassage(text), text);
});

test("a qualifying next sentence stays attached even when it exceeds the word budget", () => {
  const { summarizeReportPassage } = loadComponent();
  const caveat = "However, this does not mean that you always act immediately; your response may depend on the people involved and the situation you find yourself in.";
  assert.equal(summarizeReportPassage(`${opening} ${caveat} ${detail}`), `${opening} ${caveat}`);
});

test("conditional exceptions remain attached to long statements", () => {
  const { summarizeReportPassage } = loadComponent();
  const statement = `You may discuss ${"your thoughts and responses ".repeat(8)}with the people involved.`;
  for (const start of ["If", "When", "Even if", "Provided that"]) {
    const condition = `${start} they are not ready to talk, do not press for a response.`;
    assert.equal(summarizeReportPassage(`${statement} ${condition} ${detail}`), `${statement} ${condition}`);
  }
});

test("complete long sentences are preserved instead of cut mid-thought", () => {
  const { summarizeReportPassage } = loadComponent();
  const sentence = `You may reflect on ${"the situation and ".repeat(20)}your own response before deciding what to do.`;
  assert.equal(summarizeReportPassage(sentence), sentence);
});

test("missing, truncated, and corrupted input produces no invented summary", () => {
  const { summarizeReportPassage } = loadComponent();
  for (const value of [null, undefined, {}, 42, "", "Not detected in assigned PDF.", "When you feel", "You may feel vulner…", "You may feel vulner...", "You may \uFFFD feel safe.", "You may feelSafe."]) {
    assert.equal(summarizeReportPassage(value), null, String(value));
  }
  assert.equal(summarizeReportPassage(`${opening} An unfinished sentence`), opening);
});

test("interleaved PDF headings stop selection without repairing or guessing missing text", () => {
  const { summarizeReportPassage } = loadComponent();
  const first = "Emotions like sadness and fear may make you feel vulnerable.";
  const corrupt = `${first} You express your love Focus of Attention through sharing your protection. Core Fear Blind Spots Helplessness.`;
  assert.equal(summarizeReportPassage(corrupt), first);
  assert.equal(summarizeReportPassage("You express your love Focus of Attention through sharing protection."), null);
});

test("sentence boundaries preserve decimals and abbreviations", () => {
  const { summarizeReportPassage } = loadComponent();
  const text = "You scored 7.5 on this measure, e.g. in the recorded result. You may respond differently in other situations.";
  assert.equal(summarizeReportPassage(text), text);
});

test("abbreviations before names cannot become a truncated summary sentence", () => {
  const { summarizeReportPassage } = loadComponent();
  const sentence = `You described ${"your thoughts and responses ".repeat(10)}with Dr. Smith before making a decision.`;
  assert.equal(summarizeReportPassage(`${sentence} ${detail}`), sentence);
  assert.equal(summarizeReportPassage("You discussed your response with Dr."), null);
});

test("dependent caveats remain attached to the statements they limit", () => {
  const { summarizeReportPassage } = loadComponent();
  const statements = "You prefer to act decisively. You value initiative.";
  for (const start of ["This is only true", "That applies only", "This may change", "It depends on the situation"] ) {
    const caveat = `${start} when you feel safe and have enough information to make an informed decision under the circumstances described in this particular report, rather than in every situation.`;
    assert.equal(summarizeReportPassage(`${statements} ${caveat} ${detail}`), `${statements} ${caveat}`);
  }
  assert.equal(summarizeReportPassage(`${statements} However, this is only true when`), null);
  assert.equal(summarizeReportPassage(`${statements} However, this depends on the discussion with Dr.`), null);
});

test("older browsers keep whole text rather than guessing sentence boundaries", () => {
  const { summarizeReportPassage } = loadComponent({});
  assert.equal(summarizeReportPassage(longAction), longAction);
});

test("paragraph extraction never splits a sentence at You, Your, or As", () => {
  const { resolveCenterPatternItems } = loadComponent();
  const text = "When someone says You must act now, you may resist. Your response depends on context.";
  const report = [{ key: "thinking", text }];
  assert.deepEqual(Array.from(resolveCenterPatternItems(report, "thinking")), [text]);
});

test("PDF punctuation and heading remnants do not replace real pattern summaries", () => {
  const { resolveCenterPatternItems, renderCenterPatternRows } = loadComponent();
  for (const prefix of [":", "Worldview", "Typical Action Patterns:", "—", "● : ● Worldview"]) {
    const report = [{ key: "action", text: `${prefix} ● ${opening} ● ${qualification} ● ${detail}` }];
    const items = resolveCenterPatternItems(report, "action");
    assert.deepEqual(Array.from(items), [opening, qualification, detail], prefix);
    const html = renderCenterPatternRows(items);
    assert.equal((html.match(/data-testid="center-pattern-row"/g) || []).length, 3);
    assert.doesNotMatch(html, /unavailable|<details|Show full text/);
  }
});

test("independent intact sentences after a damaged opening remain available for summary", () => {
  const { summarizeReportPassage } = loadComponent();
  assert.equal(summarizeReportPassage(`You may \uFFFD feel safe. ${opening} ${qualification}`), `${opening} ${qualification}`);
  // A dependent sentence cannot be shown as if its damaged context were intact.
  assert.equal(summarizeReportPassage("You may \uFFFD feel safe. This only applies at work."), null);
});

test("rendered passages show concise source summaries directly without dropdowns", () => {
  const { renderReportPassage } = loadComponent();
  const html = renderReportPassage(longAction);
  assert.match(html, /data-testid="report-passage-summary"/);
  assert.ok(html.includes(`${opening} ${qualification}`));
  assert.ok(!html.includes(detail));
  assert.doesNotMatch(html, /<details|<summary|Show full text|Show less|unavailable/);
  assert.doesNotMatch(renderReportPassage(opening), /<details/);
  const escaped = renderReportPassage("You wrote <script>alert('example')</script> in your notes.");
  assert.match(escaped, /&lt;script&gt;/);
  assert.doesNotMatch(escaped, /<script>/);
});

test("text that cannot be shortened safely stays visible verbatim without invented repairs", () => {
  const { renderReportPassage } = loadComponent();
  for (const value of ["You may feel vulner...", "When you feel safe, you may share your feelings", `${opening} However, this is only true when`]) {
    const html = renderReportPassage(value);
    assert.ok(html.includes(value));
    assert.doesNotMatch(html, /unavailable|<details|Show full text/);
  }
  for (const value of [null, "", ":", "Worldview", "Not detected in assigned PDF."]) {
    assert.match(renderReportPassage(value), /Refresh.*administrator/);
  }
});

test("A to B to A refreshes inline pattern summaries without modifying the reports", () => {
  const { resolveCenterPatternItems, renderCenterPatternRows } = loadComponent();
  const a = ["action", "thinking", "feeling"].map((key) => ({ key, text: `● ${longAction}` }));
  const b = ["action", "thinking", "feeling"].map((key) => ({ key, text: "You may take time to consider your response. You do not always act immediately." }));
  const original = JSON.stringify([a, b]);
  const render = (report) => report.map(({ key }) => renderCenterPatternRows(resolveCenterPatternItems(report, key)));
  const firstA = render(a);
  const firstB = render(b);
  firstA.forEach((html, index) => {
    assert.notEqual(html, firstB[index]);
    assert.ok(html.includes(opening));
    assert.doesNotMatch(html, /<details|Show full text/);
    assert.doesNotMatch(firstB[index], /gut instinct|choice of words/);
  });
  assert.deepEqual(render(a), firstA);
  assert.equal(JSON.stringify([a, b]), original);
});

test("pattern render wiring preserves source wording and logs the active report IDs", () => {
  assert.match(source, /setHtml\(column\.listId, renderCenterPatternRows\(items, column\), \{ preserveSourceCopy: true \}\)/);
  assert.match(source, /\[centers\] source-based pattern summaries rendered/);
});
