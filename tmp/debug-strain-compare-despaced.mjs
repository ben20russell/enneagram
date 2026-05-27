import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const reportJs = fs.readFileSync(path.join(process.cwd(), 'public', 'report.js'), 'utf8');
const extracted = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tmp', 'iEQ9-Ben-Russell-PRO_extracted.json'), 'utf8'));

function deSpaceLetters(input) {
  return String(input || '').replace(/\b(?:[A-Za-z]\s){2,}[A-Za-z]\b/g, (m) => m.replace(/\s+/g, ''));
}

function extractFunctionSource(source, functionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`Missing function: ${functionName}`);
  const openBrace = source.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{') depth += 1;
    if (c === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced braces: ${functionName}`);
}

function extractConstSource(source, constName) {
  const startToken = `const ${constName} =`;
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`Missing const: ${constName}`);
  const end = source.indexOf(';\n', start);
  if (end === -1) throw new Error(`Bad const: ${constName}`);
  return source.slice(start, end + 2);
}

const needed = [
  extractFunctionSource(reportJs, 'stripPdfFooterNoiseFragments'),
  extractFunctionSource(reportJs, 'normalizeExtractedText'),
  extractFunctionSource(reportJs, 'sanitizeSnippet'),
  extractFunctionSource(reportJs, 'cleanPdfExtractedValue'),
  extractFunctionSource(reportJs, 'escapeRegex'),
  extractFunctionSource(reportJs, 'extractSnippet'),
  extractFunctionSource(reportJs, 'extractSnippetFromLabels'),
  extractFunctionSource(reportJs, 'getReportContentSections'),
  extractFunctionSource(reportJs, 'getReportContentPages'),
  extractFunctionSource(reportJs, 'getSectionByTitle'),
  extractFunctionSource(reportJs, 'getSectionCompositeText'),
  extractFunctionSource(reportJs, 'getPageAnchoredText'),
  extractFunctionSource(reportJs, 'extractStrainQualitativeWriteups'),
  extractFunctionSource(reportJs, 'extractStrainQualitativeFromReportContent'),
  extractFunctionSource(reportJs, 'isMissingExtractedText'),
  extractFunctionSource(reportJs, 'isLowQualityStrainNarrative'),
  extractFunctionSource(reportJs, 'mergeCategoryWriteups'),
  extractConstSource(reportJs, 'PDF_PAGE_ANCHORS'),
];

const ctx = { globalThis: {} };
vm.createContext(ctx);
vm.runInContext(`${needed.join('\n\n')}\n\nglobalThis.__x = { normalizeExtractedText, extractSnippetFromLabels, extractStrainQualitativeWriteups, extractStrainQualitativeFromReportContent, mergeCategoryWriteups, cleanPdfExtractedValue, escapeRegex, getPageAnchoredText, getSectionByTitle, getSectionCompositeText, PDF_PAGE_ANCHORS, isMissingExtractedText };`, ctx);
const X = ctx.globalThis.__x;

const categories = ['Happiness', 'Vocational', 'Interpersonal', 'Physical', 'Environmental', 'Psychological'];

const parsedProfile = {
  reportContent: {
    sections: [{ sectionTitle: 'Strain Profile', fullText: '' }],
    pages: (extracted.pages || []).map((p) => ({
      pageNumber: Number(p.pageNum),
      heading: `Page ${p.pageNum}`,
      extractedText: deSpaceLetters(String(p.text || '')),
      keyDataPoints: [],
    })),
  },
};

const pdfText = X.normalizeExtractedText((extracted.pages || []).map((p) => deSpaceLetters(p.text || '')).join(' '));

function legacyExtractStrainQualitativeFromReportContent(parsedProfileArg) {
  const strainSection = X.getSectionByTitle(parsedProfileArg, (title) => /strain/i.test(title));
  const text = X.normalizeExtractedText(
    [
      X.getSectionCompositeText(parsedProfileArg, strainSection),
      X.getPageAnchoredText(parsedProfileArg, X.PDF_PAGE_ANCHORS.strainProfile.overall),
      X.getPageAnchoredText(parsedProfileArg, X.PDF_PAGE_ANCHORS.strainProfile.vocational),
      X.getPageAnchoredText(parsedProfileArg, X.PDF_PAGE_ANCHORS.strainProfile.environmental),
      X.getPageAnchoredText(parsedProfileArg, X.PDF_PAGE_ANCHORS.strainProfile.physical),
      X.getPageAnchoredText(parsedProfileArg, X.PDF_PAGE_ANCHORS.strainProfile.interpersonal),
      X.getPageAnchoredText(parsedProfileArg, X.PDF_PAGE_ANCHORS.strainProfile.psychological),
      X.getPageAnchoredText(parsedProfileArg, X.PDF_PAGE_ANCHORS.strainProfile.happiness),
    ].join(' '),
  );
  if (!text) return categories.map((category) => ({ category, text: 'Not detected in structured report content.' }));

  return categories.map((category, index) => {
    const nextLabels = categories.slice(index + 1);
    const nextBoundary = nextLabels.length ? `(?:${nextLabels.map(X.escapeRegex).join('|')})\\b` : '$';
    const pattern = new RegExp(`${X.escapeRegex(category)}\\s*[:\\-]?\\s*([\\s\\S]{10,280}?)(?=\\s*${nextBoundary})`, 'i');
    const match = text.match(pattern);
    const snippet = X.cleanPdfExtractedValue(match?.[1] || '') || X.extractSnippetFromLabels(text, [category, `${category} Strain`]);
    return { category, text: snippet || 'Not detected in structured report content.' };
  });
}

function legacyMergeCategoryWriteups(structuredRows, pdfRows, cats) {
  const primaryRows = Array.isArray(structuredRows) ? structuredRows : [];
  const fallbackRows = Array.isArray(pdfRows) ? pdfRows : [];
  return cats.map((category) => {
    const primary = primaryRows.find((row) => String(row?.category || '').toLowerCase() === String(category).toLowerCase()) || null;
    const fallback = fallbackRows.find((row) => String(row?.category || '').toLowerCase() === String(category).toLowerCase()) || null;
    const primaryText = String(primary?.text || '');
    const text = !X.isMissingExtractedText(primaryText)
      ? primaryText
      : String(fallback?.text || primaryText || 'Not detected in assigned PDF.');
    return { category, text };
  });
}

const pdfRows = X.extractStrainQualitativeWriteups(pdfText);
const structuredLegacy = legacyExtractStrainQualitativeFromReportContent(parsedProfile);
const structuredCurrent = X.extractStrainQualitativeFromReportContent(parsedProfile);
const mergedLegacy = legacyMergeCategoryWriteups(structuredLegacy, pdfRows, categories);
const mergedCurrent = X.mergeCategoryWriteups(structuredCurrent, pdfRows, categories);

const out = categories.map((category) => ({
  category,
  structuredLegacy: structuredLegacy.find((r) => r.category === category)?.text || '',
  structuredCurrent: structuredCurrent.find((r) => r.category === category)?.text || '',
  mergedLegacy: mergedLegacy.find((r) => r.category === category)?.text || '',
  mergedCurrent: mergedCurrent.find((r) => r.category === category)?.text || '',
}));

console.log(JSON.stringify({ sourceFile: 'tmp/iEQ9-Ben-Russell-PRO_extracted.json', withDeSpacing: true, categories: out }, null, 2));
