const LEADING_NOISE_TOKENS = new Set([
  "ieq9",
  "ieq",
  "eq9",
  "report",
  "enneagram",
  "assessment",
  "profile",
]);

const TRAILING_NOISE_TOKEN_PATTERNS = [
  /^(pro|std)$/i,
  /^(updated|update|final|draft|copy)$/i,
  /^(report|enneagram|assessment|profile)$/i,
  /^v\d+$/i,
  /^version\d+$/i,
  /^type[1-9]$/i,
  /^ennea[1-9]$/i,
  /^[1-9]$/,
];

const GENERIC_SINGLE_TOKEN_BLACKLIST = new Set([
  "report",
  "enneagram",
  "assessment",
  "profile",
  "client",
  "sample",
  "example",
  "custom",
  "test",
  "demo",
  "updated",
  "final",
]);

function toNameCase(token) {
  const normalized = String(token || "").toLowerCase();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function cleanToken(token) {
  return String(token || "")
    .replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "")
    .trim();
}

function isTrailingNoiseToken(token) {
  return TRAILING_NOISE_TOKEN_PATTERNS.some((pattern) => pattern.test(token));
}

function normalizeTokens(fileName) {
  return String(fileName || "")
    .replace(/\.pdf$/i, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(cleanToken)
    .filter(Boolean);
}

export function extractClientNameFromReportFileName(fileName) {
  const tokens = normalizeTokens(fileName);
  if (!tokens.length) return null;

  while (tokens.length) {
    const first = String(tokens[0] || "").toLowerCase();
    const second = String(tokens[1] || "").toLowerCase();
    const startsWithVendorToken = LEADING_NOISE_TOKENS.has(first) || (first === "i" && second === "eq9");
    const splitVendorToken = first === "ieq" && second === "9";
    if (!startsWithVendorToken && !splitVendorToken) break;
    tokens.shift();
    if (splitVendorToken || (first === "i" && second === "eq9")) {
      tokens.shift();
    }
  }

  while (tokens.length > 1 && isTrailingNoiseToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  while (tokens.length && LEADING_NOISE_TOKENS.has(String(tokens[0] || "").toLowerCase())) {
    tokens.shift();
  }

  const withLetters = tokens.filter((token) => /[A-Za-z]/.test(token));
  if (!withLetters.length) return null;

  const normalizedNameTokens = withLetters.map(toNameCase).filter(Boolean);
  if (!normalizedNameTokens.length) return null;
  if (normalizedNameTokens.length === 1) {
    const lone = normalizedNameTokens[0].toLowerCase();
    if (GENERIC_SINGLE_TOKEN_BLACKLIST.has(lone) || lone.length < 2) return null;
    if (isTrailingNoiseToken(lone)) return null;
  }

  return normalizedNameTokens.join(" ");
}
