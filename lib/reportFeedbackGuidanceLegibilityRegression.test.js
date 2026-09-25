import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");

function loadGuidance() {
  const names = [
    "extractFeedbackGuidancePoints", "renderFeedbackGuidanceCell",
    "summarizeReportPassage", "renderReportPassage", "escapeHtml",
  ];
  const functions = names.map((name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing ${name}`);
    return source.slice(start, source.indexOf("\n}\n", start) + 2);
  });
  const context = vm.createContext({ Intl, console: { log() {} } });
  vm.runInContext(functions.join("\n"), context);
  return context;
}

test("feedback guidance preserves sentence context and source punctuation", () => {
  const { extractFeedbackGuidancePoints, renderFeedbackGuidanceCell } = loadGuidance();
  const text = "Give specific feedback only when the person agrees. If they do not agree, do not continue without discussing their concerns.";
  assert.deepEqual(Array.from(extractFeedbackGuidancePoints(text)), [text]);
  const html = renderFeedbackGuidanceCell(text);
  assert.ok(html.includes(text));
  assert.doesNotMatch(html, /Summary:|\.\.\.|…/);

  const unpunctuated = "Ask for their perspective before responding";
  assert.deepEqual(Array.from(extractFeedbackGuidancePoints(unpunctuated)), [unpunctuated]);
});

test("feedback guidance only splits explicit source bullets or newlines", () => {
  const { extractFeedbackGuidancePoints } = loadGuidance();
  const points = [
    "Keep listening. If the person asks you to stop, respect their request.",
    "Be direct when invited. Avoid assumptions about the person's intentions.",
    "Ask for a concrete example before drawing conclusions",
  ];
  assert.deepEqual(Array.from(extractFeedbackGuidancePoints(`• ${points[0]} ● ${points[1]}\n${points[2]}`)), points);
});

test("every guidance bullet remains visible, including entries beyond the old six-item limit", () => {
  const { renderFeedbackGuidanceCell } = loadGuidance();
  const points = Array.from({ length: 9 }, (_, index) => `Discuss example ${index + 1} only when the person is ready.`);
  const html = renderFeedbackGuidanceCell(points.map((point) => `• ${point}`).join("\n"));
  for (const point of points) assert.ok(html.includes(point), point);
  assert.equal((html.match(/data-testid="feedback-guide-point"/g) || []).length, points.length);
  assert.match(html, /data-testid="feedback-guide-cell"/);
  assert.doesNotMatch(html, /<details|<button|Show more|Show less|Show full text|display\s*:\s*none|data-feedback-guidance-extra/i);
});

test("feedback guidance uses the shared inline source summary for each passage", () => {
  const { renderFeedbackGuidanceCell, renderReportPassage } = loadGuidance();
  const opening = "Give the person time to explain their experience before you respond.";
  const qualifier = "However, this applies only when they are comfortable discussing the experience with you and have agreed that this is an appropriate time to talk about the situation.";
  const detail = "Ask for a specific example of what happened during the conversation.";
  const text = `${opening} ${qualifier} ${detail}`;
  const html = renderFeedbackGuidanceCell(text);
  assert.ok(html.includes(renderReportPassage(text)));
  assert.ok(html.includes(`${opening} ${qualifier}`));
  assert.doesNotMatch(html, /<details|Show full text|reliable short summary is unavailable/i);
});

test("feedback source text is escaped rather than rendered as markup", () => {
  const { renderFeedbackGuidanceCell } = loadGuidance();
  const html = renderFeedbackGuidanceCell('Discuss <img src=x onerror="alert(1)"> & their "example".');
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&amp; their &quot;example&quot;/);
  assert.doesNotMatch(html, /<img|<script/);
});

test("switching feedback reports A to B to A refreshes every guidance cell without changing source data", () => {
  const { renderFeedbackGuidanceCell } = loadGuidance();
  const a = Array.from({ length: 4 }, (_, index) => `• Discuss the first client's example ${index + 1}.\n• Keep their stated boundary ${index + 1} in mind.`);
  const b = Array.from({ length: 4 }, (_, index) => `• Discuss the second client's concern ${index + 1}.\n• Ask about their preferred next step ${index + 1}.`);
  const original = JSON.stringify([a, b]);
  const firstA = a.map(renderFeedbackGuidanceCell);
  const firstB = b.map(renderFeedbackGuidanceCell);
  firstA.forEach((html, index) => {
    assert.notEqual(html, firstB[index]);
    assert.match(html, /first client&#39;s example/);
    assert.doesNotMatch(firstB[index], /first client|stated boundary/);
    assert.match(firstB[index], /second client&#39;s concern/);
    assert.match(firstB[index], /preferred next step/);
  });
  assert.deepEqual(a.map(renderFeedbackGuidanceCell), firstA);
  assert.equal(JSON.stringify([a, b]), original);
});

test("missing feedback text keeps its testable cell and shared recovery message", () => {
  const { renderFeedbackGuidanceCell, renderReportPassage } = loadGuidance();
  for (const text of [null, undefined, "", "Not detected in assigned PDF."]) {
    const html = renderFeedbackGuidanceCell(text);
    assert.match(html, /data-testid="feedback-guide-cell"/);
    assert.ok(html.includes(renderReportPassage(null)));
    assert.doesNotMatch(html, /<details|<button|Summary:|\.\.\./);
  }
});
