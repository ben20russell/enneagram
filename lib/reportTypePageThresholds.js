export const REPORT_TYPE_MIN_EXPECTED_PAGES = Object.freeze({
  STD: 16,
  PRO: 42,
});

const DEFAULT_MIN_EXPECTED_PAGES = 20;

function toPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

export function inferReportTypeFromFileName(fileName) {
  const normalized = String(fileName || "").toUpperCase();
  if (!normalized) return null;

  if (/\bSTD\b/.test(normalized) || /\bSTANDARD\b/.test(normalized)) {
    return "STD";
  }
  if (/\bPRO\b/.test(normalized) || /\bPROFESSIONAL\b/.test(normalized)) {
    return "PRO";
  }

  return null;
}

export function resolveMinExpectedPagesByReportType({
  fileName,
  fallbackMinExpectedPages,
  defaultMinExpectedPages = DEFAULT_MIN_EXPECTED_PAGES,
}) {
  const reportType = inferReportTypeFromFileName(fileName);
  if (reportType && REPORT_TYPE_MIN_EXPECTED_PAGES[reportType]) {
    return REPORT_TYPE_MIN_EXPECTED_PAGES[reportType];
  }

  const normalizedFallback = toPositiveInteger(fallbackMinExpectedPages);
  if (normalizedFallback != null) return normalizedFallback;

  return toPositiveInteger(defaultMinExpectedPages) || DEFAULT_MIN_EXPECTED_PAGES;
}
