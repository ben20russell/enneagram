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

test("rendered summaries expose the complete escaped source in native disclosure controls", () => {
  const { renderReportPassage } = loadComponent();
  const text = `${longAction} <script>alert('example')</script>`;
  const html = renderReportPassage(text);
  assert.match(html, /data-testid="report-passage-summary"/);
  assert.match(html, /<details[^>]*data-testid="report-passage-details"/);
  assert.match(html, /<summary[^>]*data-testid="report-passage-toggle"/);
  assert.match(html, /Show full text/);
  assert.match(html, /Show less/);
  assert.match(html, /data-testid="report-passage-source"/);
  assert.ok(html.includes(detail));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<details[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(renderReportPassage(opening), /<details/);
});

test("unreliable source remains accessible with recovery guidance instead of fabricated copy", () => {
  const { renderReportPassage } = loadComponent();
  const html = renderReportPassage("You may feel vulner...");
  assert.match(html, /A reliable short summary is unavailable/);
  assert.match(html, /Show full text/);
  assert.match(html, /You may feel vulner\.\.\./);
  assert.match(renderReportPassage(null), /Refresh.*administrator/);
});

test("A to B to A refreshes all pattern summaries and full text without modifying the reports", () => {
  const { resolveCenterPatternItems, renderCenterPatternRows } = loadComponent();
  const a = ["action", "thinking", "feeling"].map((key) => ({ key, text: `● ${longAction}` }));
  const b = ["action", "thinking", "feeling"].map((key) => ({ key, text: "You may take time to consider your response. You do not always act immediately." }));
  const original = JSON.stringify([a, b]);
  const render = (report) => report.map(({ key }) => renderCenterPatternRows(resolveCenterPatternItems(report, key)));
  const firstA = render(a);
  const firstB = render(b);
  firstA.forEach((html, index) => {
    assert.notEqual(html, firstB[index]);
    assert.match(html, /Show full text/);
    assert.doesNotMatch(firstB[index], /gut instinct|choice of words/);
  });
  assert.deepEqual(render(a), firstA);
  assert.equal(JSON.stringify([a, b]), original);
});

test("pattern render wiring preserves source wording and logs the active report IDs", () => {
  assert.match(source, /setHtml\(column\.listId, renderCenterPatternRows\(items, column\), \{ preserveSourceCopy: true \}\)/);
  assert.match(source, /\[centers\] source-based pattern summaries rendered/);
});
