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
    extractFunctionSource(scriptSource, "getReportContentPages"),
    extractConstObjectSource(scriptSource, "ASSIGNED_PDF_INSTRUCTION_RULES"),
    extractFunctionSource(scriptSource, "getReportPageTextByNumber"),
    extractFunctionSource(scriptSource, "normalizeInstructionAnchor"),
    extractFunctionSource(scriptSource, "resolveInstructionPageCandidates"),
    extractFunctionSource(scriptSource, "findInstructionAnchorMatch"),
    extractFunctionSource(scriptSource, "extractInstructionTextFromReportContent"),
    extractFunctionSource(scriptSource, "extractCorePatternBulletsFromReportContent"),
    "globalThis.__exports = { ASSIGNED_PDF_INSTRUCTION_RULES, extractCorePatternBulletsFromReportContent };",
  ];
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(pieces.join("\n\n"), context);
  return context.globalThis.__exports;
}

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
    JSON.stringify(["Worldview", "World View", "Focus of Attention", "Core Fear", "Self-Talk", "Self Talk", "Gifts", "Vices"]),
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

test("core pattern card renders a dedicated 3-bullet container", () => {
  const reportHtmlPath = path.join(process.cwd(), "public", "report.html");
  const reportJsPath = path.join(process.cwd(), "public", "report.js");
  const html = readFileSync(reportHtmlPath, "utf8");
  const script = readFileSync(reportJsPath, "utf8");

  assert.match(
    html,
    /id="corePatternBulletsList"/,
    "Expected a dedicated Core Pattern bullet-list container in report.html.",
  );

  assert.match(
    script,
    /renderCorePatternBulletList\s*\(/,
    "Expected report.js to define a Core Pattern bullet renderer.",
  );

  assert.match(
    script,
    /setHtml\(\s*'corePatternBulletsList'\s*,\s*renderCorePatternBulletList\(/,
    "Expected render flow to hydrate Core Pattern bullets into the dedicated container.",
  );

  assert.match(
    script,
    /<strong>\$\{escapeHtml\(label\)\}:<\/strong>&nbsp;\$\{escapeHtml\(text\)\}/,
    "Expected core pattern bullet labels to render a guaranteed visible space after the colon.",
  );
});
