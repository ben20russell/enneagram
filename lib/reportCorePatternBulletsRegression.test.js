import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function in dashboard script: ${functionName}`);
  }
  const signatureEnd = source.indexOf(")", start);
  const openBrace = source.indexOf("{", signatureEnd);
  if (openBrace === -1) {
    throw new Error(`Could not parse function in dashboard script: ${functionName}`);
  }
  let depth = 0;
  for (let idx = openBrace; idx < source.length; idx += 1) {
    const char = source[idx];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, idx + 1);
      }
    }
  }
  throw new Error(`Unbalanced braces while parsing function: ${functionName}`);
}

function extractConstObjectSource(source, constName) {
  const startToken = `const ${constName} =`;
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing const object in dashboard script: ${constName}`);
  }
  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) {
    throw new Error(`Could not parse const object in dashboard script: ${constName}`);
  }
  let depth = 0;
  for (let idx = openBrace; idx < source.length; idx += 1) {
    const char = source[idx];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const semicolon = source.indexOf(";", idx);
        if (semicolon === -1) {
          throw new Error(`Missing semicolon while parsing const object: ${constName}`);
        }
        return source.slice(start, semicolon + 1);
      }
    }
  }
  throw new Error(`Unbalanced braces while parsing const object: ${constName}`);
}

function loadCorePatternExtractors() {
  const reportScriptPath = path.join(process.cwd(), "public", "report.js");
  const scriptSource = readFileSync(reportScriptPath, "utf8");
  const pieces = [
    extractFunctionSource(scriptSource, "stripPdfFooterNoiseFragments"),
    extractFunctionSource(scriptSource, "normalizeExtractedText"),
    extractFunctionSource(scriptSource, "sanitizeSnippet"),
    extractFunctionSource(scriptSource, "cleanPdfExtractedValue"),
    `const CORE_PATTERN_BULLET_DEFINITIONS = [
      { key: "action", label: "Typical Action Patterns", fallbackText: "Not detected in assigned PDF." },
      { key: "thinking", label: "Typical Thinking Patterns", fallbackText: "Not detected in assigned PDF." },
      { key: "feeling", label: "Typical Feeling Patterns", fallbackText: "Not detected in assigned PDF." },
    ];`,
    extractFunctionSource(scriptSource, "ensureSentenceStartsCapitalized"),
    extractFunctionSource(scriptSource, "sanitizeCorePatternBulletText"),
    extractFunctionSource(scriptSource, "normalizeCorePatternBullets"),
    extractFunctionSource(scriptSource, "escapeRegex"),
    extractFunctionSource(scriptSource, "buildFlexibleWordPattern"),
    extractFunctionSource(scriptSource, "buildFlexibleLabelPattern"),
    extractFunctionSource(scriptSource, "extractBulletItemsFromText"),
    extractFunctionSource(scriptSource, "escapeHtml"),
    extractFunctionSource(scriptSource, "formatOptionalText"),
    extractFunctionSource(scriptSource, "extractInlineCorePatternBulletItems"),
    extractFunctionSource(scriptSource, "renderCorePatternBulletList"),
    extractFunctionSource(scriptSource, "getReportContentPages"),
    extractConstObjectSource(scriptSource, "ASSIGNED_PDF_INSTRUCTION_RULES"),
    extractFunctionSource(scriptSource, "getReportPageTextByNumber"),
    "const INSTRUCTION_EXTRACTION_ENGINE_CACHE = new WeakMap();",
    extractFunctionSource(scriptSource, "createInstructionExtractionEngine"),
    extractFunctionSource(scriptSource, "getInstructionExtractionEngine"),
    extractFunctionSource(scriptSource, "normalizeInstructionAnchor"),
    extractFunctionSource(scriptSource, "resolveInstructionPageCandidates"),
    extractFunctionSource(scriptSource, "findInstructionAnchorMatch"),
    extractFunctionSource(scriptSource, "extractInstructionTextFromReportContent"),
    extractFunctionSource(scriptSource, "extractCorePatternBulletsFromReportContent"),
    "globalThis.__exports = { ASSIGNED_PDF_INSTRUCTION_RULES, extractCorePatternBulletsFromReportContent, renderCorePatternBulletList };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

test("core pattern renderer splits inline bullet symbols into separate list rows", () => {
  const { renderCorePatternBulletList } = loadCorePatternExtractors();
  const html = renderCorePatternBulletList([
    {
      key: "action",
      label: "Typical Action Patterns",
      text:
        "● Acting from your gut instinct to make things happen is second nature. ● You project yourself as direct and intense. ● You pursue justice and actively work to protect the vulnerable.",
    },
    { key: "thinking", label: "Typical Thinking Patterns", text: "Not detected in assigned PDF." },
    { key: "feeling", label: "Typical Feeling Patterns", text: "Not detected in assigned PDF." },
  ]);

  assert.match(html, /<ul class="core-pattern-inline-list">/);
  assert.match(html, /<li class="core-pattern-inline-item">Acting from your gut instinct to make things happen is second nature\.<\/li>/);
  assert.match(html, /<li class="core-pattern-inline-item">You project yourself as direct and intense\.<\/li>/);
  assert.match(html, /<li class="core-pattern-inline-item">You pursue justice and actively work to protect the vulnerable\.<\/li>/);
});

test("instruction-rule anchors pin core pattern bullets to pages 6-7 and section boundaries", () => {
  const { ASSIGNED_PDF_INSTRUCTION_RULES } = loadCorePatternExtractors();

  assert.equal(
    JSON.stringify(ASSIGNED_PDF_INSTRUCTION_RULES?.typicalActionPatterns?.pageNumbers || []),
    JSON.stringify([6, 7]),
    "Expected Typical Action Patterns extraction to map to pages 6-7.",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.typicalActionPatterns?.startAnchor,
    "Typical Action Patterns",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.typicalActionPatterns?.endAnchor,
    "Typical Thinking Patterns",
  );

  assert.equal(
    JSON.stringify(ASSIGNED_PDF_INSTRUCTION_RULES?.typicalThinkingPatterns?.pageNumbers || []),
    JSON.stringify([6, 7]),
    "Expected Typical Thinking Patterns extraction to map to pages 6-7.",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.typicalThinkingPatterns?.startAnchor,
    "Typical Thinking Patterns",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.typicalThinkingPatterns?.endAnchor,
    "Typical Feeling Patterns",
  );

  assert.equal(
    JSON.stringify(ASSIGNED_PDF_INSTRUCTION_RULES?.typicalFeelingPatterns?.pageNumbers || []),
    JSON.stringify([6, 7]),
    "Expected Typical Feeling Patterns extraction to map to pages 6-7.",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.typicalFeelingPatterns?.startAnchor,
    "Typical Feeling Patterns",
  );
  assert.equal(
    ASSIGNED_PDF_INSTRUCTION_RULES?.typicalFeelingPatterns?.endAnchor,
    "Blind Spots",
  );
  assert.equal(
    JSON.stringify(ASSIGNED_PDF_INSTRUCTION_RULES?.typicalFeelingPatterns?.endAnchors || []),
    JSON.stringify([
      "Typical Thinking Patterns",
      "Typical Action Patterns",
      "Worldview",
      "World View",
      "Detailed Enneagram Description",
      "Your main Enneagram style",
      "Focus of Attention",
      "Core Fear",
      "Self-Talk",
      "Self Talk",
      "Gifts",
      "Vices",
    ]),
    "Expected Typical Feeling Patterns extraction to include fallback end anchors that prevent Worldview table bleed.",
  );
});

test("core pattern extraction returns three labeled bullets from page 6-7 report content", () => {
  const { extractCorePatternBulletsFromReportContent } = loadCorePatternExtractors();
  const parsedProfile = {
    reportContent: {
      pages: [
        {
          pageNumber: 6,
          extractedText: `
            Motivation
            Typical Action Patterns
            You move quickly into action to regain control under pressure.
            Typical Thinking Patterns
            You scan for leverage and practical next steps before committing.
          `,
        },
        {
          pageNumber: 7,
          extractedText: `
            Typical Feeling Patterns
            You can protect vulnerable emotions with intensity and strength.
            Blind Spots
            You may miss subtle emotional cues in others.
          `,
        },
      ],
    },
  };

  const bullets = extractCorePatternBulletsFromReportContent(parsedProfile);

  assert.equal(Array.isArray(bullets), true);
  assert.equal(bullets.length, 3);
  assert.equal(bullets[0]?.label, "Typical Action Patterns");
  assert.equal(bullets[1]?.label, "Typical Thinking Patterns");
  assert.equal(bullets[2]?.label, "Typical Feeling Patterns");
  assert.match(String(bullets[0]?.text || ""), /move quickly into action/i);
  assert.match(String(bullets[1]?.text || ""), /scan for leverage/i);
  assert.match(String(bullets[2]?.text || ""), /protect vulnerable emotions/i);
  assert.doesNotMatch(String(bullets[2]?.text || ""), /blind spots/i);
});

test("core pattern extraction keeps Typical Feeling Patterns isolated from Worldview table copy on the same page", () => {
  const { extractCorePatternBulletsFromReportContent } = loadCorePatternExtractors();
  const parsedProfile = {
    reportContent: {
      pages: [
        {
          pageNumber: 6,
          extractedText: `
            Motivation
            Typical Action Patterns
            You move quickly into action to regain control under pressure.
            Typical Thinking Patterns
            You scan for leverage and practical next steps before committing.
          `,
        },
        {
          pageNumber: 7,
          extractedText: `
            Typical Feeling Patterns
            You feel strongly and can protect vulnerable emotions with intensity.
            Worldview
            As an Ennea 8 you tend to be quick to express anger and then move into immediate action.
            Focus of Attention
            You focus on ensuring that nobody can control you.
          `,
        },
      ],
    },
  };

  const bullets = extractCorePatternBulletsFromReportContent(parsedProfile);

  assert.equal(Array.isArray(bullets), true);
  assert.equal(bullets.length, 3);
  assert.match(String(bullets[2]?.text || ""), /protect vulnerable emotions/i);
  assert.doesNotMatch(String(bullets[2]?.text || ""), /worldview/i);
  assert.doesNotMatch(String(bullets[2]?.text || ""), /focus of attention/i);
  assert.doesNotMatch(String(bullets[2]?.text || ""), /as an ennea/i);
});

test("core pattern extraction removes Detailed Enneagram Description header spillover and keeps full feeling paragraph", () => {
  const { extractCorePatternBulletsFromReportContent } = loadCorePatternExtractors();
  const parsedProfile = {
    reportContent: {
      pages: [
        {
          pageNumber: 6,
          extractedText: `
            Typical Action Patterns
            You can be active and busy but avoid changing routines.
            Typical Thinking Patterns
            You like structured processes and predictability.
            Typical Feeling Patterns
            You may be resigned to being slightly dissatisfied with aspects of your life or relationships. You do not want to subject others to these thoughts, for fear that it will weigh them down.
            Detailed Enneagram Description
            Your main Enneagram style is not the product of your behaviour, thoughts or feelings. It is determined by the subconscious pattern of motivation that drives your personality, values and focus of attention.
            Focus of Attention
            You focus on what is missing.
          `,
        },
      ],
    },
  };

  const bullets = extractCorePatternBulletsFromReportContent(parsedProfile);
  const feelingText = String(bullets?.[2]?.text || "");

  assert.match(feelingText, /slightly dissatisfied/i);
  assert.match(feelingText, /weigh them down/i);
  assert.doesNotMatch(feelingText, /Detailed Enneagram Description/i);
  assert.doesNotMatch(feelingText, /Your main Enneagram style/i);
  assert.doesNotMatch(feelingText, /values and focus of attention/i);
});

test("core pattern extraction prevents repeated TypicalThinking section from leaking into feeling copy", () => {
  const { extractCorePatternBulletsFromReportContent } = loadCorePatternExtractors();
  const parsedProfile = {
    reportContent: {
      pages: [
        {
          pageNumber: 7,
          extractedText: `
            Typical Feeling Patterns
            • You tune in to the feelings and emotions of people around you.
            • With strong emotional intuition, you are alert to other people's feelings.
            • Since you tend to put your own feelings first, this can bias your view of facts.
            TypicalThinking Patterns
            • As an Ennea 4 your thinking is likely to be characterised by high levels of creativity.
            • You tend to internalise and receive negative data and feedback about yourself.
            Blind Spots
            • You may over-identify with your emotions.
          `,
        },
      ],
    },
  };

  const bullets = extractCorePatternBulletsFromReportContent(parsedProfile);
  const feelingText = String(bullets?.[2]?.text || "");

  assert.match(feelingText, /tune in to the feelings/i);
  assert.match(feelingText, /strong emotional intuition/i);
  assert.doesNotMatch(feelingText, /TypicalThinking Patterns/i);
  assert.doesNotMatch(feelingText, /characterised by high levels of creativity/i);
  assert.doesNotMatch(feelingText, /internalise and receive negative data/i);
});

test("overview removes Type Core Pattern card and expands Core Belief layout to three columns", () => {
  const reportHtmlPath = path.join(process.cwd(), "public", "report.html");
  const reportJsPath = path.join(process.cwd(), "public", "report.js");
  const html = readFileSync(reportHtmlPath, "utf8");
  const script = readFileSync(reportJsPath, "utf8");

  assert.doesNotMatch(
    html,
    /id="corePatternBulletsList"/,
    "Expected Type Core Pattern container to be removed from Overview.",
  );

  assert.doesNotMatch(
    html,
    /id="deepSummaryCard"/,
    "Expected Type Core Pattern card wrapper to be removed from Overview.",
  );

  assert.match(
    html,
    /<div class="mb24">\s*<div class="card" id="coreBeliefAttentionCard">/,
    "Expected Core Belief card to render in a full-width row after removing the adjacent card.",
  );

  assert.match(
    html,
    /\.core-copy-stack\{[^}]*display:grid[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[^}]*\}/,
    "Expected Core Belief content to render in three columns.",
  );

  assert.match(
    script,
    /renderCorePatternBulletList\s*\(/,
    "Expected report.js to keep Core Pattern renderer logic available even after hiding the card.",
  );

  assert.match(
    script,
    /<strong>\$\{escapeHtml\(label\)\}:<\/strong>&nbsp;\$\{escapeHtml\(text\)\}/,
    "Expected core pattern bullet labels to render a guaranteed visible space after the colon.",
  );

  assert.match(
    script,
    /class="tic neu core-pattern-row-marker"/,
    "Expected core pattern rows to use a smaller dedicated leading bullet marker class.",
  );

  assert.match(
    script,
    /<ul class="core-pattern-inline-list">/,
    "Expected core pattern renderer to place inline bullet text into a dedicated list container.",
  );

  assert.match(
    script,
    /<li class="core-pattern-inline-item">\$\{escapeHtml\(item\)\}<\/li>/,
    "Expected inline core pattern bullet segments to render as separate list-item lines.",
  );

  assert.match(
    html,
    /\.core-pattern-row-marker\{[^}]*--bullet-size:20px[^}]*font-size:9px[^}]*\}/,
    "Expected core pattern leading bullet marker to render smaller via shared bullet-size alignment tokens.",
  );

  assert.match(
    html,
    /\.core-pattern-inline-list\{[^}]*display:flex[^}]*flex-direction:column[^}]*\}/,
    "Expected core pattern inline bullet list to render as a stacked multi-line list.",
  );
});
