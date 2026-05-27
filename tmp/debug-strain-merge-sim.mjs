import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.join(process.cwd(), 'public', 'report.js'), 'utf8');

function extractFunctionSource(code, name) {
  const start = code.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Missing ${name}`);
  const open = code.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced ${name}`);
}

const pieces = [
  extractFunctionSource(source, 'sanitizeSnippet'),
  extractFunctionSource(source, 'stripPdfFooterNoiseFragments'),
  extractFunctionSource(source, 'normalizeExtractedText'),
  extractFunctionSource(source, 'cleanPdfExtractedValue'),
  extractFunctionSource(source, 'isMissingExtractedText'),
  extractFunctionSource(source, 'isLowQualityStrainNarrative'),
  extractFunctionSource(source, 'mergeCategoryWriteups'),
  'globalThis.__x = { mergeCategoryWriteups, isMissingExtractedText };',
];

const ctx = { globalThis: {} };
vm.createContext(ctx);
vm.runInContext(pieces.join('\n\n'), ctx);
const X = ctx.globalThis.__x;

const categories = ['Happiness','Vocational','Interpersonal','Physical','Environmental','Psychological'];

const structuredRows = [
  { category: 'Happiness', text: 'Low Vocational: Medium' },
  { category: 'Vocational', text: 'Medium Interpersonal: Medium' },
  { category: 'Interpersonal', text: 'Medium Physical: Medium' },
  { category: 'Physical', text: 'Medium Environmental: Low' },
  { category: 'Environmental', text: 'STRAIN LOW OVERALL STRAIN LEVEL MEDIUM' },
  { category: 'Psychological', text: "strain is LOW.· You experience yourself as able to cope with your present circumstances." },
];

const fallbackRows = [
  { category: 'Happiness', text: 'Happiness strain is LOW. You are not feeling emotionally overwhelmed by current pressures.' },
  { category: 'Vocational', text: 'Vocational strain is MEDIUM. Work demands are present and require steady pacing.' },
  { category: 'Interpersonal', text: 'Interpersonal strain is MEDIUM. Relationships require attention and regular repair.' },
  { category: 'Physical', text: 'Physical strain is MEDIUM. Your energy is somewhat taxed and benefits from recovery routines.' },
  { category: 'Environmental', text: 'Environmental strain is LOW. External context feels mostly manageable right now.' },
  { category: 'Psychological', text: 'Psychological strain is LOW. You experience yourself as able to cope with present circumstances.' },
];

function legacyMergeCategoryWriteups(structuredRowsArg, pdfRowsArg, categoriesArg) {
  const primaryRows = Array.isArray(structuredRowsArg) ? structuredRowsArg : [];
  const fallbackRowsArgSafe = Array.isArray(pdfRowsArg) ? pdfRowsArg : [];
  return categoriesArg.map((category) => {
    const primary = primaryRows.find((row) => String(row?.category || '').toLowerCase() === String(category).toLowerCase()) || null;
    const fallback = fallbackRowsArgSafe.find((row) => String(row?.category || '').toLowerCase() === String(category).toLowerCase()) || null;
    const primaryText = String(primary?.text || '');
    const text = !X.isMissingExtractedText(primaryText)
      ? primaryText
      : String(fallback?.text || primaryText || 'Not detected in assigned PDF.');
    return { category, text };
  });
}

const legacy = legacyMergeCategoryWriteups(structuredRows, fallbackRows, categories);
const current = X.mergeCategoryWriteups(structuredRows, fallbackRows, categories);

const byCategory = categories.map((category) => ({
  category,
  before: legacy.find((r) => r.category === category)?.text || '',
  after: current.find((r) => r.category === category)?.text || '',
}));

console.log(JSON.stringify({ categories: byCategory }, null, 2));
