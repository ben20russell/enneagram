import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/report.js", import.meta.url), "utf8");

function loadDecisionStrain() {
  const names = [
    "stripPdfFooterNoiseFragments", "normalizeExtractedText", "sanitizeSnippet",
    "cleanPdfExtractedValue", "normalizeColonSpacing", "isMissingExtractedText",
    "escapeHtml", "ensureSentenceStartsCapitalized", "formatOptionalText", "buildAdaptiveListHtml",
    "getReportContentPages", "getReportContentSections", "getSectionCompositeText",
    "getTargetedSections", "parseSpreadsheetFocusObjectCandidate",
    "normalizeDecisionStrainCopy", "extractDecisionStrainCopyFromText",
    "resolveDecisionStrainCopy", "renderDecisionStrainCopy", "setHtml", "normalizeDashboardHtmlCopy",
  ];
  const functions = names.flatMap((name) => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) return [];
    const next = source.indexOf("\nfunction ", start + 1);
    return [source.slice(start, next < 0 ? undefined : next)];
  });
  const context = vm.createContext({ console: { log() {} } });
  vm.runInContext(functions.join("\n"), context);
  return context;
}

const moderateRows = [
  "If you are operating at an optimal level of arousal (eustress), your decision making performance is likely to increase",
  "Consider areas where you may be experiencing higher levels of strain at present and how these impact on your decision making",
  "As your strain level increases, be aware of your willingness to consult others and the potential for reactive decision making",
  "As your strain level decreases, be aware of complacency, deadlines and your capacity to act on priorities with urgency",
];
const highRows = [
  "More likely to rely on your Limbic System when making decisions, thereby impacting on your capacity to access your rational and objective faculties in your Prefrontal Cortex",
  "More anxious and susceptible to the pressure surrounding the decision, while also impacting on your perception of the relative importance of a decision",
  "Make you potentially more reactive and defensive when decisions are challenged",
  "Short term focus, immediate results, crisis decisions",
  "Exhaustion and depleted energy reserves are likely to impact negatively on the quality of your decisions",
  "Premature closure when analysing information or consulting others",
  "Limits flexibility and scope of exploration",
];
const lowRows = [
  "Your decision making is unlikely to be negatively impacted by strain at present",
  "Be aware of complacency and remain attentive to deadlines when making decisions",
];

function strainBlock(name, level, rows) {
  return `${level} Strain\n${name}, the ${level.toLowerCase()} level of strain you are experiencing at present is likely to impact on your decision making in the following ways:\n${rows.map((row) => `● ${row}`).join("\n")}`;
}

function reportPages(pages, extra = {}) {
  return { ...extra, reportContent: { pages: pages.map(([pageNumber, extractedText]) => ({ pageNumber, extractedText })) } };
}

test("decision strain extraction skips the generic strain mention that produced the screenshot fragment", () => {
  const { extractDecisionStrainCopyFromText } = loadDecisionStrain();
  const intro = "Your decision style is not only strongly impacted by your dominant Center of Intelligence but also by your main Ennea type and the amount of strain you are experiencing at present. Effective and wise decisions are made when all three Centers of Intelligence are positively engaged in the decision making process.";
  const result = extractDecisionStrainCopyFromText(`${intro}\n[Page 34]\n${strainBlock("Corinne", "High", highRows)}`);
  assert.match(result, /Corinne, the high level of strain/);
  for (const row of highRows) assert.ok(result.includes(row), `Missing decision strain advice: ${row}`);
  assert.doesNotMatch(result, /Your decision style is not only|Effective and wise decisions/);
  assert.notEqual(result.toLowerCase(), "you are experiencing at present");
});

for (const [name, level, rows] of [["Ashmi", "Moderate", moderateRows], ["Sarah", "Low", lowRows]]) {
  test(`decision strain preserves the complete ${level.toLowerCase()} block for ${name}`, () => {
    const { extractDecisionStrainCopyFromText } = loadDecisionStrain();
    const result = extractDecisionStrainCopyFromText(strainBlock(name, level, rows));
    assert.ok(result.includes(`${name}, the ${level.toLowerCase()} level of strain`));
    for (const row of rows) assert.ok(result.includes(row), `Missing decision strain advice: ${row}`);
  });
}

test("decision strain extraction ends before footer and the following report section", () => {
  const { extractDecisionStrainCopyFromText } = loadDecisionStrain();
  const result = extractDecisionStrainCopyFromText(`${strainBlock("Ben", "Moderate", moderateRows)}\nCopyright 2010-2024 Integrative Enneagram Solutions Ben Russell 34 of 42\n[Page 35]\nLeadership and Management\nDo not display this unrelated leadership paragraph in decision strain.`);
  assert.ok(result.includes(moderateRows.at(-1)));
  assert.doesNotMatch(result, /Copyright|34 of 42|Page 35|Leadership|unrelated leadership/);
});

test("an explicit decision-strain heading works without a level-specific heading", () => {
  const { extractDecisionStrainCopyFromText } = loadDecisionStrain();
  const result = extractDecisionStrainCopyFromText(`Impact of strain on decision making\n${moderateRows.map((row) => `● ${row}`).join("\n")}\nStrategic Leadership\nThis is another report section.`);
  for (const row of moderateRows) assert.ok(result.includes(row));
  assert.doesNotMatch(result, /Strategic Leadership|another report section/);
});

test("normalization rejects missing copy, incomplete fragments, and truncated advice", () => {
  const { normalizeDecisionStrainCopy } = loadDecisionStrain();
  for (const invalid of [null, "", "Not detected in assigned PDF.", "You are experiencing at present", "Your decision making is likely to...", "Your decision making is likely to…"]) {
    assert.equal(normalizeDecisionStrainCopy(invalid), null, `Invalid copy was accepted: ${invalid}`);
  }
});

test("overall strain overview does not masquerade as decision strain information", () => {
  const { extractDecisionStrainCopyFromText, resolveDecisionStrainCopy } = loadDecisionStrain();
  const overall = "Overall Strain. Your strain profile provides an indication of your current load. This indicator provides you with an aggregate, big picture view of how much strain you are experiencing at present. Ben your perceived level of Overall strain is MODERATE.";
  assert.equal(extractDecisionStrainCopyFromText(overall), null);
  assert.equal(resolveDecisionStrainCopy(reportPages([[18, overall]])), null);
});

test("page 34 decision-specific copy wins over page 18 overall strain and broken stored text", () => {
  const { resolveDecisionStrainCopy } = loadDecisionStrain();
  const report = reportPages([
    [18, "Your strain profile provides an overview. Overall Strain Ben your perceived level of Overall strain is MODERATE. This is general strain information."],
    [34, strainBlock("Ben", "Moderate", moderateRows)],
  ], { spreadsheetFocuses: { decisionStrainCopy: "You are experiencing at present" } });
  const result = resolveDecisionStrainCopy(report);
  assert.match(result, /Ben, the moderate level of strain/);
  for (const row of moderateRows) assert.ok(result.includes(row));
  assert.doesNotMatch(result, /general strain information|Your strain profile provides/);
});

test("complete source pages recover a targeted extraction cut off after 420 characters", () => {
  const { resolveDecisionStrainCopy } = loadDecisionStrain();
  const full = strainBlock("Corinne", "High", highRows);
  const report = reportPages([[34, full]], {
    targetedSections: { decision_framework: { strain_impact: `${full.slice(0, 420)}...` } },
  });
  const result = resolveDecisionStrainCopy(report);
  assert.ok(result.includes(highRows.at(-1)));
  assert.doesNotMatch(result, /\.\.\.$/);
});

test("decision strain resolves targeted arrays and all supported legacy stored shapes", () => {
  const { resolveDecisionStrainCopy } = loadDecisionStrain();
  const copy = strainBlock("Ashmi", "Moderate", moderateRows);
  const variants = [
    { targetedSections: { decision_framework: { strain_impact: [copy] } } },
    { spreadsheetFocuses: { decisionStrainCopy: copy } },
    { spreadsheetFocuses: { decisionMaking: { impact_of_strain: copy } } },
    { spreadsheetFocuses: { decisionMaking: JSON.stringify({ impact_of_strain: copy }) } },
    { attachedProfile: { decision_making: { impact_of_strain: copy } } },
  ];
  for (const report of variants) {
    const result = resolveDecisionStrainCopy(report);
    assert.ok(result?.includes(moderateRows.at(-1)), `Failed stored source shape: ${Object.keys(report)[0]}`);
  }
});

test("PDF text recovers a stored fragment even when page objects are unavailable", () => {
  const { resolveDecisionStrainCopy } = loadDecisionStrain();
  const result = resolveDecisionStrainCopy({ spreadsheetFocuses: { decisionStrainCopy: "You are experiencing at present" } }, strainBlock("Sarah", "Low", lowRows));
  assert.match(result, /Sarah, the low level of strain/);
  for (const row of lowRows) assert.ok(result.includes(row));
});

test("normalization and rendering preserve more than 2000 characters and more than eight advice rows", () => {
  const { normalizeDecisionStrainCopy, renderDecisionStrainCopy } = loadDecisionStrain();
  const rows = Array.from({ length: 11 }, (_, index) => `Decision strain observation ${index + 1}: ${moderateRows[1]}. ${moderateRows[2]}. This source sentence must remain complete through its final words.`);
  const text = strainBlock("Sample", "Moderate", rows);
  assert.ok(text.length > 2000);
  const normalized = normalizeDecisionStrainCopy(text);
  const html = renderDecisionStrainCopy(normalized);
  for (const row of rows) {
    assert.ok(normalized.includes(row), `Normalization omitted complete source row ${row}`);
    assert.ok(html.includes(row), `Rendered output omitted complete source row ${row}`);
  }
});

test("decision strain rendering escapes imported text", () => {
  const { renderDecisionStrainCopy } = loadDecisionStrain();
  const row = "Your decision making can be affected by strain. Treat <img src=x onerror=alert(1)> as imported text.";
  const html = renderDecisionStrainCopy(strainBlock("Sample", "Moderate", [row]));
  assert.doesNotMatch(html, /<img\b/);
  assert.match(html, /&lt;img/);
});

test("missing or fragment-only source shows recovery guidance without inferred strain advice", () => {
  const { resolveDecisionStrainCopy, renderDecisionStrainCopy } = loadDecisionStrain();
  const result = resolveDecisionStrainCopy({ spreadsheetFocuses: { decisionStrainCopy: "You are experiencing at present" } });
  assert.equal(result, null);
  const html = renderDecisionStrainCopy(result);
  assert.match(html, /refresh|retry|contact/i);
  assert.doesNotMatch(html, /You are experiencing at present|moderate level|high level|low level/i);
});

test("switching client reports derives and renders each report's strain information without stale state", () => {
  const { resolveDecisionStrainCopy, renderDecisionStrainCopy } = loadDecisionStrain();
  const high = reportPages([[34, strainBlock("Corinne", "High", highRows)]], { id: "corinne-report" });
  const low = reportPages([[34, strainBlock("Sarah", "Low", lowRows)]], { id: "sarah-report" });
  const original = JSON.stringify([high, low]);
  const first = renderDecisionStrainCopy(resolveDecisionStrainCopy(high));
  const second = renderDecisionStrainCopy(resolveDecisionStrainCopy(low));
  const third = renderDecisionStrainCopy(resolveDecisionStrainCopy(high));
  assert.match(first, /Corinne, the high level/);
  assert.match(second, /Sarah, the low level/);
  assert.doesNotMatch(second, /Corinne|Limbic System|Premature closure/);
  assert.equal(third, first);
  assert.equal(JSON.stringify([high, low]), original);
});

test("a truncated earlier targeted row cannot override complete stored guidance", () => {
  const { resolveDecisionStrainCopy } = loadDecisionStrain();
  const report = {
    targetedSections: { decision_framework: { strain_impact: [
      "Consider areas where you may be experiencing higher levels of strain and how these impact on decision mak...",
      moderateRows.at(-1),
    ] } },
    spreadsheetFocuses: { decisionStrainCopy: strainBlock("Ashmi", "Moderate", moderateRows) },
  };
  const result = resolveDecisionStrainCopy(report);
  for (const row of moderateRows) assert.ok(result.includes(row));
  assert.doesNotMatch(result, /decision mak\.\.\./);
});

test("a separately stored page heading identifies the full decision strain narrative", () => {
  const { resolveDecisionStrainCopy } = loadDecisionStrain();
  const full = strainBlock("Ashmi", "Moderate", moderateRows);
  const report = { reportContent: { pages: [{
    pageNumber: 34,
    heading: "Moderate Strain",
    extractedText: full.replace(/^Moderate Strain\n/, ""),
  }] } };
  const result = resolveDecisionStrainCopy(report);
  assert.match(result, /Ashmi, the moderate level/);
  for (const row of moderateRows) assert.ok(result.includes(row));
});

test("decision strain resolves a report section using the supported text property", () => {
  const { resolveDecisionStrainCopy } = loadDecisionStrain();
  const report = { reportContent: { sections: [{
    sectionTitle: "Decision Making",
    text: strainBlock("Sarah", "Low", lowRows),
  }] } };
  const result = resolveDecisionStrainCopy(report);
  assert.match(result, /Sarah, the low level/);
  for (const row of lowRows) assert.ok(result.includes(row));
});

test("section boundary phrases within advice do not cut off decision strain content", () => {
  const { extractDecisionStrainCopyFromText } = loadDecisionStrain();
  const rows = [
    "Higher strain can affect leadership and management decisions at work.",
    "Consider all your options when making decisions under strain.",
  ];
  const result = extractDecisionStrainCopyFromText(strainBlock("Sample", "Moderate", rows));
  for (const row of rows) assert.ok(result.includes(row));
});

test("flattened PDF fallback stops at the next titled section without a footer or line breaks", () => {
  const { extractDecisionStrainCopyFromText } = loadDecisionStrain();
  const flattened = `${strainBlock("Ben", "Moderate", moderateRows)} Leadership and Management This unrelated leadership paragraph belongs to the next report section.`.replace(/\s+/g, " ");
  const result = extractDecisionStrainCopyFromText(flattened);
  for (const row of moderateRows) assert.ok(result.includes(row));
  assert.doesNotMatch(result, /Leadership and Management|unrelated leadership paragraph|next report section/);
});

test("rendering preserves complete high strain guidance and intact source words", () => {
  const { renderDecisionStrainCopy } = loadDecisionStrain();
  const html = renderDecisionStrainCopy(strainBlock("Corinne", "High", highRows));
  for (const row of highRows) assert.ok(html.includes(row), `Rendering changed source advice: ${row}`);
  assert.doesNotMatch(html, /there by|imp acting/);
});

test("OCR joined words in the actual page 34 introduction do not hide low strain guidance", () => {
  const { resolveDecisionStrainCopy } = loadDecisionStrain();
  const full = strainBlock("Corinne", "Low", [
    "Enable you more access to your Prefrontal Cortex, thereby increasing the quality of your decisions and the extent to which you rely on in-depth analysis",
    "If you are bored with your present circumstances, this can lead to delayed, slow decisions or procrastination",
    "Make you more open to considering the long term implications of decisions",
    "Enable you to consider the inputs and ideas of others more, thereby leading to a decision making style that is potentially more inclusive or collaborative",
    "May decrease your capacity to accurately identify priorities when making decisions",
    "Make you complacent about decisions that need to be made",
  ]).replace("decision making in the following ways", "decision makingin the following ways");
  const report = reportPages([[34, full]], {
    spreadsheetFocuses: { decisionStrainCopy: "You are experiencing at present" },
  });
  const result = resolveDecisionStrainCopy(report);
  assert.match(result, /Corinne, the low level/);
  assert.match(result, /Make you complacent about decisions that need to be made/);
});

test("the original Ben page 34 excerpt preserves all advice without its encoded PDF footer", () => {
  const { resolveDecisionStrainCopy, renderDecisionStrainCopy } = loadDecisionStrain();
  const footer = "\u0004*+4-$\"#/\u0001\u007f}~}¦\u007f}\u007f\u007f\u0001\n)/ \"-\u001c/$1 \u0001\u0006)) \u001c\"-\u001c(\u0001\u0014*'0/$*). \u0003 )\u0001\u00130.. '' \u0080\u0081\u0001*!\u0001\u0081\u007f";
  const excerpt = [
    "Moderate Strain",
    "Ben, the moderate level of strain you are experiencing at present is likely to impact on your decisionmaking in the following ways:",
    "● If you are operating at an optimal level of arousal (eustress), your",
    "decision making performance is likely to increase● Consider areas where you may be experiencing higher levels of strain at",
    "present and how these impact on your decision making● As your strain level increases, be aware of your willingness to consult",
    "others and the potential for reactive decision making● As your strain level decreases, be aware of complacency, deadlines and",
    "your capacity to act on priorities with urgency",
    footer,
  ].join("\n");
  for (const text of [excerpt, excerpt.replace(/\s+/g, " ")]) {
    const copy = resolveDecisionStrainCopy(reportPages([[34, text]]));
    assert.match(copy, /impact on your decision making in the following ways/);
    for (const row of moderateRows) assert.ok(copy.includes(row), "Missing source advice: " + row);
    assert.ok(copy.endsWith(moderateRows.at(-1)), "The last advice row must end before the encoded footer");
    assert.equal((renderDecisionStrainCopy(copy).match(/data-testid="decision-strain-row-/g) || []).length, 4);
  }
});

test("the original Corinne page 34 excerpt repairs a joined word without rewriting source advice", () => {
  const { resolveDecisionStrainCopy, renderDecisionStrainCopy } = loadDecisionStrain();
  const excerpt = [
    "Low Strain",
    "Corinne, the low level of strain you are experiencing at present is likely to impact on your decision makingin the following ways:",
    "● Enable you more access to your Prefrontal Cortex, thereby increasing the",
    "quality of your decisions and the extent to which you rely on in-depthanalysis",
    "● If you are bored with your present circumstances, this can lead to",
    "delayed, slow decisions or procrastination",
    "● Make you more open to considering the long term implications of",
    "decisions",
    "● Enable you to consider the inputs and ideas of others more, thereby",
    "leading to a decision making style that is potentially more inclusive or",
    "collaborative",
    "● May decrease your capacity to accurately identify priorities when making",
    "decisions",
    "● Make you complacent about decisions that need to be made",
    "Copyright 2010-2024 Integrative Enneagram Solutions Corinne Aparis 34 of 42",
  ].join("\n");
  const copy = resolveDecisionStrainCopy(reportPages([[34, excerpt]]));
  const expected = excerpt.replace(/\bdecision makingin\b/g, "decision making in")
    .replace(/\bin-depthanalysis\b/g, "in-depth analysis")
    .replace(/^Low Strain\s*/, "").replace(/\s*Copyright[\s\S]*$/, "")
    .replace(/\s+/g, " ").trim();
  assert.equal(copy, expected);
  const html = renderDecisionStrainCopy(copy);
  assert.equal((html.match(/data-testid="decision-strain-row-/g) || []).length, 6);
  assert.match(html, /thereby increasing/);
  assert.doesNotMatch(html, /there by|Copyright|in-depthanalysis/);
});

test("mounting decision guidance keeps its source words and escapes embedded markup", () => {
  const context = loadDecisionStrain();
  const target = { innerHTML: "" };
  context.document = { getElementById: () => target };
  context.spreadsheetFocusesFromReport = {
    decisionStrainCopy: strainBlock("Alex", "High", [highRows[0], "Consider <b>your priorities</b> when making decisions."]),
  };
  const mount = source.match(/setHtml\(\s*'decisionStrainCopy',[\s\S]*?\n\s*\);/)?.[0];
  assert.ok(mount, "The production render flow mounts decision guidance");
  vm.runInContext(mount, context);
  assert.ok(target.innerHTML.includes(highRows[0]), "Source wording survives the shared DOM setter");
  assert.match(target.innerHTML, /&lt;b&gt;your priorities&lt;\/b&gt;/);
});
