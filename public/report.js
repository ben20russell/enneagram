const AUTH_BASE_URL =
  (window.__AUTH_BASE_URL__ && String(window.__AUTH_BASE_URL__).trim()) ||
  window.localStorage.getItem("AUTH_BASE_URL") ||
  window.location.origin;

function getAuthBaseUrl() {
  return AUTH_BASE_URL.replace(/\/$/, "");
}

function getAuthButton() {
  return document.getElementById("authSignInButton");
}

function getAuthMenu() {
  return document.getElementById("authMenu");
}

function getAdminPageLink() {
  return document.getElementById("authAdminPageLink");
}

function getExportPdfButton() {
  return document.getElementById("authExportPdfButton");
}

function getReportActiveChip() {
  return document.getElementById("reportActiveChip");
}

function getReportSwitchControl() {
  return document.getElementById("reportSwitchControl");
}

function getClientReportSwitchControl() {
  return document.getElementById("clientReportSwitchControl");
}

function getClientReportSelector() {
  return document.getElementById("clientReportSelector");
}

const ADMIN_EMAILS = new Set([
  "ben20russell@gmail.com",
  "corinne.aparis@gmail.com",
  "corinne@corinneaparis.com",
]);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hasAdminAccess(email) {
  return ADMIN_EMAILS.has(normalizeEmail(email));
}

function updateAdminPageLink(email) {
  const adminLink = getAdminPageLink();
  if (!adminLink) return;
  const allowed = hasAdminAccess(email);
  adminLink.style.display = allowed ? "block" : "none";
}

function setReportActiveChipVisible(visible) {
  const chip = getReportActiveChip();
  if (!chip) return;
  chip.style.display = visible ? "inline-flex" : "none";
}

function setReportSwitchVisible(visible) {
  const control = getReportSwitchControl();
  if (!control) return;
  control.style.display = visible ? "flex" : "none";
}

function setClientReportSwitchVisible(visible) {
  const control = getClientReportSwitchControl();
  if (!control) return;
  control.style.display = visible ? "flex" : "none";
}

function canViewExampleReports({ email, isAuthenticated }) {
  if (!Boolean(isAuthenticated)) return true;
  return hasAdminAccess(email);
}

let assignedReportIngested = false;
let exampleReportInitialized = false;
let latestReportActiveData = null;
let currentSignedInUser = null;
let currentReportViewMode = "example";
let latestAssignedPdfReport = null;
let lastAppliedExampleType = "8";
let latestAdminClientReports = [];
let latestAdminClientReportsById = new Map();
let currentClientReportId = null;

function resetClientReportSelectorSelection() {
  const clientReportSelector = getClientReportSelector();
  if (!clientReportSelector) return;
  clientReportSelector.value = "";
}

function clearAdminClientReportState() {
  latestAdminClientReports = [];
  latestAdminClientReportsById = new Map();
  currentClientReportId = null;
  populateClientReportSelector([]);
  setClientReportSwitchVisible(false);
}

function buildClientReportOptionLabel(clientReport, index) {
  const clientName = String(clientReport?.clientName || "").trim();
  if (clientName) return clientName;
  const userEmail = String(clientReport?.userEmail || "").trim();
  if (userEmail.includes("@")) {
    const localPart = userEmail.split("@")[0] || "";
    const cleanedLocalPart = localPart.replace(/[._-]+/g, " ").trim();
    if (cleanedLocalPart) {
      return cleanedLocalPart
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
    }
  }
  return `Client ${index + 1}`;
}

function populateClientReportSelector(clientReports) {
  const clientReportSelector = getClientReportSelector();
  if (!clientReportSelector) return;

  const previousValue = String(clientReportSelector.value || "").trim();
  const safeClientReports = Array.isArray(clientReports) ? clientReports : [];
  clientReportSelector.innerHTML = "";

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = safeClientReports.length ? "Select client report" : "No client reports";
  clientReportSelector.appendChild(placeholderOption);

  safeClientReports.forEach((clientReport, index) => {
    const reportId = String(clientReport?.id || "").trim();
    if (!reportId) return;
    const option = document.createElement("option");
    option.value = reportId;
    option.textContent = buildClientReportOptionLabel(clientReport, index);
    clientReportSelector.appendChild(option);
  });

  const hasPreviousValue = safeClientReports.some(
    (clientReport) => String(clientReport?.id || "").trim() === previousValue,
  );
  clientReportSelector.value = hasPreviousValue ? previousValue : "";
}

function setExportPdfState({ visible, enabled }) {
  const exportButton = getExportPdfButton();
  if (!exportButton) return;
  exportButton.style.display = visible ? "block" : "none";
  exportButton.disabled = !enabled;
}

function applyRandomExampleReport() {
  const reportSelector = document.getElementById("reportSelector");
  if (!reportSelector) return;
  const randomizedType = String(Math.floor(Math.random() * 9) + 1);
  reportSelector.value = randomizedType;
  console.log("[report-switch] randomized initial example report to", randomizedType);
  applyReport(randomizedType);
  exampleReportInitialized = true;
}

function applySelectedExampleReportOrFallback() {
  const reportSelector = getReportSelector();
  const selectedType = String(reportSelector?.value || "").trim();
  const nextType = /^[1-9]$/.test(selectedType) ? selectedType : "8";
  if (reportSelector) reportSelector.value = nextType;
  currentClientReportId = null;
  resetClientReportSelectorSelection();
  currentReportViewMode = "example";
  applyReport(nextType);
  exampleReportInitialized = true;
}

function getReportSelector() {
  return document.getElementById("reportSelector");
}

function getMyReportSelectorOption() {
  return document.getElementById("reportSelectorMyReportOption");
}

function setMyReportOptionVisible(visible) {
  const option = getMyReportSelectorOption();
  if (!option) return;
  option.style.display = visible ? "block" : "none";
}

function setOverviewAdminDiagnosticsVisible(email) {
  const isAdmin = hasAdminAccess(email);
  const diagnosticsSection = document.getElementById("sec-test");
  const diagnosticsContainer = document.getElementById("adminTestDiagnostics");
  const testNavButtons = document.querySelectorAll('.nav button[data-sec="test"],.mobile-menu-item[data-sec="test"]');
  testNavButtons.forEach((button) => {
    button.style.display = isAdmin ? "" : "none";
  });
  if (diagnosticsSection) diagnosticsSection.style.display = isAdmin ? "" : "none";
  if (diagnosticsContainer) diagnosticsContainer.style.display = isAdmin ? "" : "none";
  const currentSectionId = String(document.querySelector(".sec.active")?.id || "").replace(/^sec-/, "");
  if (!isAdmin && currentSectionId === "test") {
    showSec("overview");
  }
  buildReportModuleIndex();
}

function isAssignedReportAvailable(data) {
  if (!data || !data.isAuthenticated) return false;
  const hasAssignedReport = Boolean(data.hasAssignedReport) || Boolean(data.reportFileName);
  const isPdfRenderable = Boolean(data.isPdfRenderable);
  return hasAssignedReport && isPdfRenderable;
}

function selectMyReportInSelector() {
  const selector = getReportSelector();
  if (!selector) return;
  const option = getMyReportSelectorOption();
  if (!option || option.style.display === "none") return;
  selector.value = "my-report";
}

function stripPdfFooterNoiseFragments(rawText) {
  return String(rawText || "")
    .replace(/\b(?:[A-Za-z](?:[ \t]+)){2,}[A-Za-z]\b/g, (match) => {
      const source = String(match || "");
      const marked = source.replace(/[ \t]{2,}/g, "\u0000");
      const collapsed = marked.replace(/[ \t]+/g, "");
      // If OCR removed all word boundaries, keep readable spacing between letters
      // rather than returning one giant merged token.
      if (!collapsed.includes("\u0000") && collapsed.length >= 24) {
        return source.replace(/[ \t]+/g, " ").trim();
      }
      return collapsed.replace(/\u0000/g, " ");
    })
    .replace(/\b(?:\d(?:[ \t]+)){2,}\d\b/g, (match) => {
      const marked = String(match || "").replace(/[ \t]{2,}/g, "\u0000");
      return marked.replace(/[ \t]+/g, "").replace(/\u0000/g, " ");
    })
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Copyright\s*\d{4}\s*[-–]\s*\d{4}[\s\S]*?\d+\s*of\s*\d+/gis, " ")
    .replace(
      /Integrative\s*Enneagram(?:\s*Solutions)?\s*Ben\s*Russell[\s\S]{0,120}?\d+\s*of\s*\d+/gis,
      " ",
    )
    .replace(
      /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\s*20\d{2}\s*\[\s*ENGLISH\s*\][\s\S]{0,240}?STRICTLY\s*CONFIDENTIAL[\s\S]{0,280}?COPYRIGHT\s*\d{2,4}\s*[-–]\s*\d{2,4}\b/gis,
      " ",
    )
    .replace(
      /\bSTRICTLY\s*CONFIDENTIAL\b[\s\S]{0,220}?\bINDIVIDUAL\b[\s\S]{0,220}?\bPROFESSIONAL\b[\s\S]{0,220}?\bCOPYRIGHT\s*\d{2,4}\s*[-–]\s*\d{2,4}\b/gis,
      " ",
    );
}

function normalizeExtractedText(rawText) {
  return stripPdfFooterNoiseFragments(rawText)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function inferTypeFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const score = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0 };
  const weightedPatterns = [
    { regex: /Main\s*Type\s*[:\-]?\s*Type\s*([1-9])\b/gi, weight: 18, source: "mainType" },
    {
      regex: /you\s+resonate\s+with\s+the\s+Enneagram\s+type\s*([1-9])\b/gi,
      weight: 16,
      source: "resonanceSentence",
    },
    {
      regex: /main\s+type\s+as\s+an\s+Ennea\s*([1-9])\b/gi,
      weight: 14,
      source: "mainTypeAsEnnea",
    },
    { regex: /Enneagram\s+type\s*([1-9])\b/gi, weight: 10, source: "enneagramType" },
    { regex: /type\s*([1-9])\s+which\s+is\s+also\s+known\s+as/gi, weight: 10, source: "typeKnownAs" },
    { regex: /Your\s*Type\s*[:\-]?\s*([1-9])\b/gi, weight: 8, source: "yourType" },
    { regex: /\bTYPE\s*([1-9])\s*(?:\||[—-])/gi, weight: 6, source: "headerType" },
    { regex: /\bEnnea\s*([1-9])\b/gi, weight: 3, source: "ennea" },
    { regex: /Type\s*([1-9])\b/gi, weight: 1, source: "genericType" },
  ];

  let strongestSource = "none";
  let strongestWeight = 0;
  const blacklistedContext = /(all\s+9\s+types?|9\s+Enneagram\s+styles?)/i;

  for (const entry of weightedPatterns) {
    let match;
    while ((match = entry.regex.exec(normalized)) !== null) {
      const type = String(match[1] || "");
      if (!score[type]) continue;
      const contextStart = Math.max(0, match.index - 36);
      const contextEnd = Math.min(normalized.length, match.index + 54);
      const contextWindow = normalized.slice(contextStart, contextEnd);
      if (blacklistedContext.test(contextWindow)) continue;
      score[type] += entry.weight;
      if (entry.weight > strongestWeight) {
        strongestWeight = entry.weight;
        strongestSource = entry.source;
      }
    }
  }

  let winningType = null;
  let winningScore = -1;
  for (const type of Object.keys(score)) {
    if (score[type] > winningScore) {
      winningType = type;
      winningScore = score[type];
    }
  }

  if (!winningType || winningScore <= 0) {
    return { type: null, confidence: "none", source: "none" };
  }

  const confidence = winningScore >= 16 ? "high" : winningScore >= 8 ? "medium" : "low";
  return { type: winningType, confidence, source: strongestSource || "scoredPdfText" };
}

function extractTypeNameFromPdfText(pdfText, detectedType) {
  const normalized = normalizeExtractedText(pdfText);
  const typeHint = detectedType ? String(detectedType) : "[1-9]";
  const patterns = [
    new RegExp(`you\\s+resonate\\s+with\\s+the\\s+Enneagram\\s+type\\s*${typeHint}\\s+which\\s+is\\s+also\\s+known\\s+as\\s*the\\s*([A-Za-z][A-Za-z\\s-]{2,40})`, "i"),
    new RegExp(`Main\\s*Type\\s*[:\\-]?\\s*Type\\s*${typeHint}\\s*[—-]\\s*([^\\.;\\n]{3,80})`, "i"),
    new RegExp(`Type\\s*${typeHint}\\s*[—-]\\s*([^\\.;\\n]{3,80})`, "i"),
    new RegExp(`([A-Z][A-Z\\s]{6,40})\\s+[^\\n]{0,120}Enneagram\\s+type\\s*${typeHint}\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return String(match[1])
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim();
    }
  }
  return null;
}

function instinctCodeToLabel(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (normalized === "SX") return "SX — One-on-One";
  if (normalized === "SO") return "SO — Social";
  if (normalized === "SP") return "SP — Self-Preservation";
  return null;
}

function extractInstinctFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const codedMatch = normalized.match(/\bwith\s+a\s+(SO|SP|SX)\s+Instinct(?:\b|[A-Z])/i);
  if (codedMatch?.[1]) {
    return instinctCodeToLabel(codedMatch[1]) || codedMatch[1].toUpperCase();
  }

  const patterns = [
    /Dominant\s*Instinct\s*[:\-]?\s*([A-Za-z]{2,4}\s*[—-]\s*[A-Za-z][A-Za-z\s-]{2,40})/i,
    /\b(SO|SP|SX)\s*[—-]\s*(Social|Self[\s-]?Preservation|One[\s-]?on[\s-]?One)\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return String(match[1]).replace(/\s+/g, " ").trim();
    if (match?.[0]) return String(match[0]).replace(/\s+/g, " ").trim();
  }
  return null;
}

function extractConnectedLineType(pdfText, label) {
  const normalized = normalizeExtractedText(pdfText);
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`${escapedLabel}\\s*[:\\-]?\\s*Type\\s*([1-9])\\b`, "i"));
  return match?.[1] ? `Type ${match[1]}` : null;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractLabeledSectionValue(pdfText, label, nextLabels) {
  const normalized = normalizeExtractedText(pdfText);
  const escapedLabel = escapeRegex(label);
  const nextGroup = (nextLabels || [])
    .map((nextLabel) => escapeRegex(nextLabel))
    .join("|");
  if (!nextGroup) return null;
  const pattern = new RegExp(
    `${escapedLabel}\\s*[:\\-]?\\s*(.+?)(?=\\s*(?:${nextGroup})\\b)`,
    "i",
  );
  const match = normalized.match(pattern);
  if (!match?.[1]) return null;
  return sanitizeSnippet(match[1], null);
}

function cleanPdfExtractedValue(value) {
  return sanitizeSnippet(
    stripPdfFooterNoiseFragments(String(value || ""))
      .replace(/\u0000/g, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+([.,;:!?])/g, "$1"),
    null,
  );
}

function extractBetweenMarkers(pdfText, startLabel, endLabel) {
  const normalized = normalizeExtractedText(pdfText);
  const pattern = new RegExp(
    `${escapeRegex(startLabel)}\\s*[:\\-]?\\s*([\\s\\S]{2,420}?)\\s*${escapeRegex(endLabel)}\\b`,
    "i",
  );
  const match = normalized.match(pattern);
  if (!match?.[1]) return null;
  return cleanPdfExtractedValue(match[1]);
}

function extractGiftsFromCoreBlock(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const patterns = [
    /Gifts\s*[:\-]?\s*(.+?)\s*Vices\b/i,
    /Gi\S*s\s*[:\-]?\s*(.+?)\s*Vices\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return cleanPdfExtractedValue(match[1]);
  }
  return null;
}

function extractCoreIdentityBlock(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const corePattern =
    /Worldview\s*([\s\S]{5,240}?)\s*Focus\s*of\s*Attention\s*([\s\S]{5,260}?)\s*Core\s*Fear\s*([\s\S]{5,220}?)\s*Self[-\s]*Talk\s*([\s\S]{5,200}?)\s*(?:Gi[\s\S]{0,3}s|Gifts)\s*([\s\S]{3,220}?)\s*Vices\s*([\s\S]{3,280}?)(?=\s*DEVELOPMENT\s*EXERCISE)/i;
  const match = normalized.match(corePattern);
  if (!match) return null;
  return {
    worldview: cleanPdfExtractedValue(match[1]),
    focus: cleanPdfExtractedValue(match[2]),
    coreFear: cleanPdfExtractedValue(match[3]),
    selfTalk: cleanPdfExtractedValue(match[4]),
    gifts: cleanPdfExtractedValue(match[5]),
    vices: cleanPdfExtractedValue(match[6]),
  };
}

function extractCorePatternLinesFromText(text) {
  const normalized = normalizeExtractedText(text);
  if (!normalized) return [];
  const match = normalized.match(
    /Typical\s+Feeling\s+Patterns\s*:?\s*([\s\S]{40,2600}?)(?=Blind\s+Spots\b|World\s*view\b|Worldview\b|Focus\s+of\s+Attention\b|Core\s+Fear\b|DEVELOPMENT\s+EXERCISE\b|$)/i,
  );
  const block = cleanPdfExtractedValue(match?.[1] || "");
  if (!block) return [];
  const bullets = block
    .replace(/\s*[•●◦▪]\s*/g, "\n")
    .split(/\n+/)
    .map((line) => cleanPdfExtractedValue(line.replace(/^[-–—]\s*/, "")))
    .filter((line) => line && line.length >= 24 && !/^typical feeling patterns[:\s]*$/i.test(line));
  let lines = bullets;
  if (!lines.length) {
    lines = (block.match(/[^.!?]+[.!?]/g) || [])
      .map((line) => cleanPdfExtractedValue(line))
      .filter((line) => line && line.length >= 24);
  }
  return Array.from(new Set(lines)).slice(0, 4);
}

function extractSubtypeKeywordFromPdfText(pdfText, detectedType) {
  const normalized = normalizeExtractedText(pdfText);
  const hint = detectedType ? String(detectedType) : "[1-9]";
  const subtypeMatch = normalized.match(
    new RegExp(`A\\s+deeper\\s+understanding\\s+of\\s+the\\s+(SX|SO|SP)\\s*[—-]\\s*${hint}\\b`, "i"),
  );
  if (subtypeMatch?.[1]) {
    return `${String(subtypeMatch[1]).toUpperCase()} - ${detectedType || "?"}`;
  }
  const instinctMatch = normalized.match(/\bwith\s+a\s+(SO|SP|SX)\s+Instinct(?:\b|[A-Z])/i);
  if (instinctMatch?.[1]) {
    const instinctCode = String(instinctMatch[1]).toUpperCase();
    if (detectedType) return `${instinctCode} - ${detectedType}`;
    return instinctCode;
  }
  return null;
}

function extractLineTypeFromFlowSection(pdfText, kind) {
  const normalized = normalizeExtractedText(pdfText);
  const kindPatterns =
    kind === "release"
      ? [
          /point\s*of\s*release\s*is\s*likely\s*to\s*be\s*at\s*Ennea\s*([1-9])\b/i,
          /Release\s*Point[^.]{0,320}at\s*Ennea\s*([1-9])\b/i,
        ]
      : [
          /point\s*of\s*(?:stress|tension)\s*is\s*likely\s*to\s*be\s*at\s*Ennea\s*([1-9])\b/i,
          /Stretch\s*Point[^.]{0,320}at\s*Ennea\s*([1-9])\b/i,
        ];
  for (const pattern of kindPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return `Type ${match[1]}`;
  }
  return null;
}

function extractEnneagramProfileScores(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const emptyProfile = {
    "1": null,
    "2": null,
    "3": null,
    "4": null,
    "5": null,
    "6": null,
    "7": null,
    "8": null,
    "9": null,
  };
  const anchorMatch = normalized.match(
    /Enneagram\s*Profile[^]{0,2200}|all\s*9\s*types[^]{0,2200}/i,
  );
  if (!anchorMatch?.[0]) {
    return emptyProfile;
  }

  const windowText = anchorMatch[0];
  const profile = { ...emptyProfile };
  const pattern = /\b([1-9])\s*[\):\-]\s*(\d{1,3})\b/g;
  let match;
  while ((match = pattern.exec(windowText)) !== null) {
    const type = String(match[1]);
    const score = Number(match[2]);
    if (!Number.isFinite(score) || score < 10 || score > 99) continue;
    if (profile[type] == null) {
      profile[type] = score;
    }
  }
  const filledTypes = Object.values(profile).filter((value) => Number.isFinite(value)).length;
  if (filledTypes < 6) {
    return emptyProfile;
  }
  return profile;
}

function hasInformativeScoreMap(scoreMap, minPositive = 2) {
  if (!scoreMap || typeof scoreMap !== "object") return false;
  const values = Object.values(scoreMap).map((value) => toFiniteScoreOrNull(value));
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) return false;
  const positiveCount = finiteValues.filter((value) => value > 0).length;
  return positiveCount >= minPositive;
}

function normalizeScoreScale(scoreMap) {
  if (!scoreMap || typeof scoreMap !== "object") return null;
  const cleaned = {};
  Object.entries(scoreMap).forEach(([key, value]) => {
    cleaned[key] = toFiniteScoreOrNull(value);
  });
  const values = Object.values(cleaned).filter((value) => Number.isFinite(value));
  if (!values.length) return cleaned;
  const max = Math.max(...values);
  if (max <= 10) {
    const scaled = {};
    Object.entries(cleaned).forEach(([key, value]) => {
      const numeric = toFiniteScoreOrNull(value);
      scaled[key] = Number.isFinite(numeric) ? Math.round(numeric * 10) : null;
    });
    return scaled;
  }
  return cleaned;
}

function scoreMapHasVariance(scoreMap, keys = null) {
  if (!scoreMap || typeof scoreMap !== "object") return false;
  const sourceKeys = Array.isArray(keys) && keys.length ? keys : Object.keys(scoreMap);
  const values = sourceKeys
    .map((key) => toFiniteScoreOrNull(scoreMap[key]))
    .filter((value) => Number.isFinite(value));
  if (values.length < 2) return false;
  return new Set(values.map((value) => Math.round(Number(value)))).size >= 2;
}

function shouldPreferQualitativeScoreMap(existingScores, qualitativeScores, options) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const minPositive = Number(safeOptions.minPositive || 2);
  if (!hasInformativeScoreMap(qualitativeScores, minPositive)) return false;
  if (!hasInformativeScoreMap(existingScores, minPositive)) return true;

  const existingHasVariance = scoreMapHasVariance(existingScores);
  const qualitativeHasVariance = scoreMapHasVariance(qualitativeScores);
  if (!existingHasVariance && qualitativeHasVariance) return true;

  const existingValues = Object.values(existingScores || {})
    .map((value) => toFiniteScoreOrNull(value))
    .filter((value) => Number.isFinite(value));
  const qualitativeValues = Object.values(qualitativeScores || {})
    .map((value) => toFiniteScoreOrNull(value))
    .filter((value) => Number.isFinite(value));
  const existingMax = existingValues.length ? Math.max(...existingValues) : null;
  const qualitativeMax = qualitativeValues.length ? Math.max(...qualitativeValues) : null;

  // Prefer qualitative values if existing extraction collapsed to uniformly low values.
  if (
    Number.isFinite(existingMax) &&
    Number.isFinite(qualitativeMax) &&
    existingMax <= 30 &&
    qualitativeMax >= 55
  ) {
    return true;
  }

  return false;
}

const CC_FINGERPRINT = {
  profileScores: {
    "1": 50,
    "2": 71,
    "3": 43,
    "4": 46,
    "5": 56,
    "6": 53,
    "7": 50,
    "8": 78,
    "9": 13,
  },
  instinctScores: {
    sexual: 54,
    social: 29,
    selfPreservation: 17,
  },
  centerScores: {
    body: 47,
    heart: 27,
    head: 25,
  },
  interactionScores: {
    assertive: 44,
    reactive: 51,
  },
  strainScores: {
    happiness: 46,
    vocational: 33,
    interpersonal: 26,
    physical: 33,
    environmental: 6,
    psychological: 6,
    overall: 26,
  },
};

function hasExactScoreFingerprint(actual, expected) {
  if (!actual || typeof actual !== "object" || !expected || typeof expected !== "object") return false;
  return Object.keys(expected).every((key) => Number(actual[key]) === Number(expected[key]));
}

function isLikelyProReport({ reportFileName, parsedProfile, reportContentText }) {
  const fileName = String(reportFileName || "").toLowerCase();
  if (fileName.includes("pro")) return true;
  const pageCount = Array.isArray(parsedProfile?.reportContent?.pages) ? parsedProfile.reportContent.pages.length : 0;
  if (pageCount >= 20) return true;
  const text = normalizeExtractedText(reportContentText || "");
  return /27\s*subtypes|strategic leadership|team behaviour|coaching relationship|feedback guide/i.test(text);
}

function isCcFingerprintData({ profileScores, instinctScoresRaw, centerScoresRaw, interactionScores, strainScoresRaw }) {
  return (
    hasExactScoreFingerprint(profileScores, CC_FINGERPRINT.profileScores) ||
    hasExactScoreFingerprint(instinctScoresRaw, CC_FINGERPRINT.instinctScores) ||
    hasExactScoreFingerprint(centerScoresRaw, CC_FINGERPRINT.centerScores) ||
    hasExactScoreFingerprint(interactionScores, CC_FINGERPRINT.interactionScores) ||
    hasExactScoreFingerprint(strainScoresRaw, CC_FINGERPRINT.strainScores)
  );
}

function getLevelVisualScore(level) {
  const normalized = String(level || "").trim().toUpperCase();
  if (normalized === "HIGH") return 80;
  if (normalized === "MEDIUM" || normalized === "MODERATE") return 55;
  if (normalized === "LOW") return 25;
  return null;
}

function toFiniteScoreOrNull(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const levelScore = getLevelVisualScore(trimmed);
    if (levelScore != null) return levelScore;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const levelScore = getLevelVisualScore(value);
  if (levelScore != null) return levelScore;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getParsedProfileStrainScores(parsedProfile) {
  if (!parsedProfile || typeof parsedProfile !== "object") return null;

  const orderedKeys = ["happiness", "vocational", "interpersonal", "physical", "environmental", "psychological"];
  const blank = {
    happiness: null,
    vocational: null,
    interpersonal: null,
    physical: null,
    environmental: null,
    psychological: null,
    overall: null,
  };

  function canonicalizeStrainKey(rawKey) {
    const compact = String(rawKey || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (!compact) return null;
    const normalized = compact.endsWith("strain") ? compact.slice(0, -6) : compact;
    if (normalized === "happiness" || normalized === "happy") return "happiness";
    if (normalized === "vocational" || normalized === "occupation" || normalized === "occupational" || normalized === "career" || normalized === "work") return "vocational";
    if (normalized === "interpersonal" || normalized === "relationship" || normalized === "relationships" || normalized === "relational") return "interpersonal";
    if (normalized === "physical" || normalized === "body" || normalized === "somatic") return "physical";
    if (normalized === "environmental" || normalized === "environment" || normalized === "external" || normalized === "context") return "environmental";
    if (normalized === "psychological" || normalized === "mental" || normalized === "mind") return "psychological";
    if (normalized === "overall" || normalized === "total") return "overall";
    return null;
  }

  function normalizeStrainScoreValue(rawValue) {
    const numeric = toFiniteScoreOrNull(rawValue);
    if (!Number.isFinite(numeric)) return null;

    let normalized = Number(numeric);
    if (normalized >= 1 && normalized <= 3) {
      if (normalized >= 2.5) normalized = 80;
      else if (normalized >= 1.5) normalized = 55;
      else normalized = 25;
    } else if (normalized > 3 && normalized <= 10) {
      normalized = normalized * 10;
    }

    normalized = Math.max(0, Math.min(100, Math.round(normalized)));
    return normalized;
  }

  function mapCandidateSource(candidate) {
    if (!candidate) return null;
    if (Array.isArray(candidate)) {
      const mapped = { ...blank };
      orderedKeys.forEach((key, index) => {
        mapped[key] = normalizeStrainScoreValue(candidate[index]);
      });
      const finiteValues = orderedKeys
        .map((key) => mapped[key])
        .filter((value) => Number.isFinite(value));
      if (!finiteValues.length) return null;
      mapped.overall = Math.round(finiteValues.reduce((sum, value) => sum + Number(value), 0) / finiteValues.length);
      return mapped;
    }
    if (typeof candidate !== "object") return null;

    const mapped = { ...blank };
    Object.entries(candidate).forEach(([rawKey, rawValue]) => {
      const key = canonicalizeStrainKey(rawKey);
      if (!key) return;
      const value = normalizeStrainScoreValue(rawValue);
      if (value == null) return;
      mapped[key] = value;
    });
    const finiteValues = orderedKeys
      .map((key) => mapped[key])
      .filter((value) => Number.isFinite(value));
    if (!finiteValues.length && !Number.isFinite(mapped.overall)) return null;
    if (!Number.isFinite(mapped.overall) && finiteValues.length) {
      mapped.overall = Math.round(finiteValues.reduce((sum, value) => sum + Number(value), 0) / finiteValues.length);
    }
    return mapped;
  }

  const candidateSources = [
    parsedProfile?.targetedSections?.strain_interpretation,
    parsedProfile?.strainScores,
    parsedProfile?.strain_scores,
    parsedProfile?.strainProfile,
    parsedProfile?.strain_profile,
    parsedProfile?.strainLevels,
    parsedProfile?.strain_levels,
    parsedProfile?.strain,
  ];

  const merged = { ...blank };
  let hasValue = false;
  candidateSources.forEach((source) => {
    const mapped = mapCandidateSource(source);
    if (!mapped) return;

    orderedKeys.forEach((key) => {
      if (merged[key] == null && mapped[key] != null) {
        merged[key] = mapped[key];
      }
    });
    if (merged.overall == null && mapped.overall != null) {
      merged.overall = mapped.overall;
    }
    hasValue = true;
  });

  if (!hasValue) return null;
  const finiteValues = orderedKeys
    .map((key) => merged[key])
    .filter((value) => Number.isFinite(value));
  if (!finiteValues.length && !Number.isFinite(merged.overall)) return null;
  if (!Number.isFinite(merged.overall) && finiteValues.length) {
    merged.overall = Math.round(finiteValues.reduce((sum, value) => sum + Number(value), 0) / finiteValues.length);
  }
  return merged;
}

const FLEXIBLE_LEVEL_TOKEN_PATTERN =
  "((?:L\\s*O\\s*W)|(?:M\\s*E\\s*D\\s*I\\s*U\\s*M)|(?:H\\s*I\\s*G\\s*H)|(?:M\\s*O\\s*D\\s*E\\s*R\\s*A\\s*T\\s*E(?:\\s*L\\s*Y)?)|(?:H\\s*I\\s*G\\s*H\\s*L\\s*Y)|(?:L\\s*O\\s*W\\s*L\\s*Y))";

function normalizeFlexibleLevelToken(value) {
  const normalized = String(value || "").replace(/[^A-Za-z]/g, "").trim().toUpperCase();
  if (normalized === "HIGH" || normalized === "HIGHLY") return "HIGH";
  if (normalized === "MEDIUM" || normalized === "MODERATE" || normalized === "MODERATELY") return "MEDIUM";
  if (normalized === "LOW" || normalized === "LOWLY") return "LOW";
  return null;
}

function buildFlexibleWordPattern(word) {
  return String(word || "")
    .split("")
    .map((char) => (/[A-Za-z0-9]/.test(char) ? `${escapeRegex(char)}\\s*` : escapeRegex(char)))
    .join("");
}

function buildFlexibleLabelPattern(label) {
  return String(label || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => buildFlexibleWordPattern(word))
    .join("\\s*");
}

function buildFlexiblePhrasePattern(phrase) {
  return buildFlexibleLabelPattern(phrase);
}

function extractLevelForLabel(text, label) {
  const normalized = normalizeExtractedText(text);
  if (!normalized) return null;
  const escaped = escapeRegex(label);
  const directMatch = normalized.match(new RegExp(`${escaped}[\\s\\S]{0,64}?${FLEXIBLE_LEVEL_TOKEN_PATTERN}`, "i"));
  const directLevel = normalizeFlexibleLevelToken(directMatch?.[1]);
  if (directLevel) return directLevel;

  const flexibleLabel = buildFlexibleLabelPattern(label);
  if (!flexibleLabel) return null;
  const fuzzyMatch = normalized.match(new RegExp(`${flexibleLabel}[\\s\\S]{0,72}?${FLEXIBLE_LEVEL_TOKEN_PATTERN}`, "i"));
  const fuzzyLevel = normalizeFlexibleLevelToken(fuzzyMatch?.[1]);
  if (fuzzyLevel) return fuzzyLevel;

  const expressionMatch = normalized.match(
    new RegExp(
      `${flexibleLabel}[\\s\\S]{0,42}?\\b(?:is\\s+)?${FLEXIBLE_LEVEL_TOKEN_PATTERN}[\\s\\S]{0,28}?\\b(?:expressed|expression)\\b`,
      "i",
    ),
  );
  return normalizeFlexibleLevelToken(expressionMatch?.[1]);
}

function extractLabelLevelPairs(text, labels, options = {}) {
  const normalized = normalizeExtractedText(text);
  if (!normalized) return {};
  const maxGap = Number.isFinite(Number(options?.maxGap)) ? Number(options.maxGap) : 64;
  const labelGroup = (Array.isArray(labels) ? labels : [])
    .map((label) => escapeRegex(label))
    .filter(Boolean)
    .join("|");
  if (!labelGroup) return {};

  const out = {};
  const pattern = new RegExp(`\\b(${labelGroup})\\b[^A-Za-z]{0,${maxGap}}(LOW|MEDIUM|HIGH|MODERATE)\\b`, "gi");
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const label = String(match[1] || "").toLowerCase();
    const level = String(match[2] || "").toUpperCase();
    if (!label || !level) continue;
    out[label] = level;
  }
  if (Object.keys(out).length) return out;

  (Array.isArray(labels) ? labels : []).forEach((label) => {
    const resolvedLevel = extractLevelForLabel(normalized, label);
    if (resolvedLevel) out[String(label || "").toLowerCase()] = resolvedLevel;
  });
  return out;
}

function buildCenterScoresFromQualitativeText(text) {
  const pairedLevels = extractLabelLevelPairs(text, [
    "Action Center of Expression",
    "Feeling Center of Expression",
    "Thinking Center of Expression",
  ]);
  const action = getLevelVisualScore(
    pairedLevels["action center of expression"] || extractLevelForLabel(text, "Action Center of Expression"),
  );
  const feeling = getLevelVisualScore(
    pairedLevels["feeling center of expression"] || extractLevelForLabel(text, "Feeling Center of Expression"),
  );
  const thinking = getLevelVisualScore(
    pairedLevels["thinking center of expression"] || extractLevelForLabel(text, "Thinking Center of Expression"),
  );
  const scores = {
    body: action,
    heart: feeling,
    head: thinking,
  };
  return hasInformativeScoreMap(scores, 2) ? scores : null;
}

function buildStrainScoresFromQualitativeText(text) {
  const pairedLevels = extractLabelLevelPairs(text, [
    "Happiness strain",
    "Vocational strain",
    "Interpersonal strain",
    "Physical strain",
    "Environmental strain",
    "Psychological strain",
  ]);
  const scores = {
    happiness: getLevelVisualScore(pairedLevels["happiness strain"] || extractLevelForLabel(text, "Happiness strain")),
    vocational: getLevelVisualScore(pairedLevels["vocational strain"] || extractLevelForLabel(text, "Vocational strain")),
    interpersonal: getLevelVisualScore(
      pairedLevels["interpersonal strain"] || extractLevelForLabel(text, "Interpersonal strain"),
    ),
    physical: getLevelVisualScore(pairedLevels["physical strain"] || extractLevelForLabel(text, "Physical strain")),
    environmental: getLevelVisualScore(
      pairedLevels["environmental strain"] || extractLevelForLabel(text, "Environmental strain"),
    ),
    psychological: getLevelVisualScore(
      pairedLevels["psychological strain"] || extractLevelForLabel(text, "Psychological strain"),
    ),
  };
  const values = Object.values(scores).filter((value) => Number.isFinite(Number(value)));
  if (!values.length) return null;
  return { ...scores, overall: Math.round(values.reduce((sum, value) => sum + Number(value), 0) / values.length) };
}

function buildInstinctVisualScores({ instinct, reportContentText }) {
  const dominant = String(instinct || "").toUpperCase();
  const hasSx = /\bSX\b/.test(dominant) || /ONE-TO-ONE|ONE TO ONE/i.test(reportContentText || "");
  const hasSo = /\bSO\b/.test(dominant) || /\bSOCIAL\b/i.test(reportContentText || "");
  const hasSp = /\bSP\b/.test(dominant) || /SELF-?PRESERV/i.test(reportContentText || "");
  const scores = {
    sexual: hasSx ? 80 : 35,
    social: hasSo ? 80 : 35,
    selfPreservation: hasSp ? 80 : 35,
  };
  const topCount = Object.values(scores).filter((value) => value === 80).length;
  if (topCount === 0) return null;
  if (topCount > 1) {
    if (hasSx) scores.sexual = 80;
    if (hasSo) scores.social = 55;
    if (hasSp) scores.selfPreservation = 55;
  }
  return scores;
}

function extractStrainScoresFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const categories = ["Happiness", "Vocational", "Interpersonal", "Physical", "Environmental", "Psychological"];
  const scores = {};
  categories.forEach((category) => {
    const match = normalized.match(new RegExp(`${escapeRegex(category)}\\s*[:\\-]?\\s*(\\d{1,3})\\b`, "i"));
    scores[category.toLowerCase()] = match?.[1] ? Number(match[1]) : null;
  });

  const detectedValues = Object.values(scores).filter((value) => Number.isFinite(value));
  if (!detectedValues.length) return null;
  const overall = Math.round(detectedValues.reduce((sum, value) => sum + value, 0) / detectedValues.length);
  return { ...scores, overall };
}

function extractSnippetFromLabels(pdfText, labels) {
  for (const label of labels) {
    const value = extractSnippet(pdfText, label);
    if (value) return value;
  }
  return null;
}

function extractIntegrationFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const patterns = [
    /Integration\s*Level\s*[:\-]?\s*(High|Moderate|Low)\b/i,
    /\b(High|Moderate|Low)\s+Integration\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const value = String(match[1]).toLowerCase();
      return value.charAt(0).toUpperCase() + value.slice(1);
    }
  }
  return null;
}

function sanitizeSnippet(value, fallback) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    // OCR occasionally injects a bogus "C'" token ahead of sentence starts.
    .replace(/(^|[.!?]\s+)\s*C['’`´]\s*(?=[A-Z])/g, "$1")
    .replace(/^C['’`´]\s*(?=[A-Z])/, "")
    .trim();
  if (!cleaned) return fallback;
  return cleaned;
}

function cleanupTypeName(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text
    .replace(/\b(Assertive|Decisive|Protective|Independent|Influential)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupMetaQuote(value) {
  const cleaned = String(value || "")
    .replace(/^YOUR\s+META-MESSAGE\s*[:\-]?\s*/i, "")
    .replace(/\s+Communication\s*$/i, "");
  return sanitizeSnippet(cleaned, null);
}

function extractSnippet(pdfText, label) {
  const normalized = normalizeExtractedText(pdfText);
  if (!normalized) return null;
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flexibleLabel = String(label || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      String(word || "")
        .split("")
        .map((char) => (/[A-Za-z0-9]/.test(char) ? `${escapeRegex(char)}\\s*` : escapeRegex(char)))
        .join(""),
    )
    .join("\\s*");
  const candidatePatterns = [
    new RegExp(`${escapedLabel}\\s*[:\\-]\\s*([^\\.\\n]{8,320})`, "i"),
    new RegExp(`${escapedLabel}\\s*[:\\-]?\\s*([^\\.\\n]{8,320})`, "i"),
  ];
  if (flexibleLabel) {
    candidatePatterns.push(
      new RegExp(`${flexibleLabel}\\s*[:\\-]\\s*([^\\.\\n]{8,320})`, "i"),
      new RegExp(`${flexibleLabel}\\s*[:\\-]?\\s*([^\\.\\n]{8,320})`, "i"),
    );
  }

  for (const pattern of candidatePatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanPdfExtractedValue(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function renderAssignedIngestCard(payload) {
  const card = document.getElementById("assignedIngestCard");
  const summary = document.getElementById("assignedIngestSummary");
  if (!card || !summary) return;

  const lines = [];
  if (payload?.fileName) lines.push(`Source file: ${payload.fileName}`);
  if (payload?.detectedType) {
    lines.push(`Detected Enneagram type: ${payload.detectedType}`);
    lines.push(`Detection source: ${payload.detectedTypeSource || "unknown"}`);
  }
  if (payload?.basicFear) lines.push(`Basic Fear: ${payload.basicFear}`);
  if (payload?.basicDesire) lines.push(`Basic Desire: ${payload.basicDesire}`);
  if (payload?.passion) lines.push(`Passion: ${payload.passion}`);

  summary.textContent = lines.length
    ? lines.join(" | ")
    : "Assigned PDF ingested successfully. Dashboard is now using your uploaded report context.";
  card.style.display = "block";
}

function hideAssignedIngestCard() {
  const card = document.getElementById("assignedIngestCard");
  if (card) card.style.display = "none";
}

async function extractPdfTextFromSignedUrl(signedUrl) {
  if (!signedUrl || !window.pdfjsLib) return "";

  if (window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const loadingTask = window.pdfjsLib.getDocument({ url: signedUrl });
  const pdfDoc = await loadingTask.promise;
  const pageLimit = pdfDoc.numPages;
  const chunks = [];

  console.log("[report-ingest] Parsing assigned PDF pages", {
    totalPages: pdfDoc.numPages,
  });

  for (let page = 1; page <= pageLimit; page += 1) {
    const pageDoc = await pdfDoc.getPage(page);
    const content = await pageDoc.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ");
    chunks.push(pageText);
  }

  return chunks.join("\n");
}

async function ingestAssignedReportIntoDashboard(data) {
  if (assignedReportIngested || !data) return;
  assignedReportIngested = true;

  try {
    const serverContext = data?.ingestedDashboardContext || null;
    const parsedProfile = data?.ingestedParsedProfile || null;
    const reportContentText = normalizeExtractedText(
      Array.isArray(parsedProfile?.reportContent?.pages)
        ? parsedProfile.reportContent.pages
            .map((page) =>
              [page?.heading, page?.sectionTitle, page?.extractedText, ...(Array.isArray(page?.keyDataPoints) ? page.keyDataPoints : [])]
                .filter(Boolean)
                .join(" "),
            )
            .join(" ")
        : "",
    );
    let pdfText = "";
    let detectedType =
      serverContext?.detectedType ||
      (parsedProfile?.primaryType ? String(parsedProfile.primaryType) : null);
    let detectedTypeSource = serverContext?.detectedTypeSource || null;
    let basicFear = serverContext?.basicFear || parsedProfile?.coreFear || null;
    let basicDesire = serverContext?.basicDesire || parsedProfile?.coreDesire || null;
    let passion = serverContext?.passion || parsedProfile?.passion || null;
    let typeName = parsedProfile?.typeName || null;
    let instinct = instinctCodeToLabel(parsedProfile?.instinctualVariant) || null;
    let subtypeKeyword = parsedProfile?.subtypeKeyword || null;
    let connectedLineA = parsedProfile?.connectedLineA || (parsedProfile?.arrowDynamics?.integration
      ? `Type ${parsedProfile.arrowDynamics.integration}`
      : null);
    let connectedLineB = parsedProfile?.connectedLineB || (parsedProfile?.arrowDynamics?.disintegration
      ? `Type ${parsedProfile.arrowDynamics.disintegration}`
      : null);
    let profileScores = parsedProfile?.typeScores
      ? {
          "1": parsedProfile.typeScores.type1 ?? null,
          "2": parsedProfile.typeScores.type2 ?? null,
          "3": parsedProfile.typeScores.type3 ?? null,
          "4": parsedProfile.typeScores.type4 ?? null,
          "5": parsedProfile.typeScores.type5 ?? null,
          "6": parsedProfile.typeScores.type6 ?? null,
          "7": parsedProfile.typeScores.type7 ?? null,
          "8": parsedProfile.typeScores.type8 ?? null,
          "9": parsedProfile.typeScores.type9 ?? null,
        }
      : null;
    profileScores = normalizeScoreScale(profileScores);
    let integrationLevel = serverContext?.integrationLevel || parsedProfile?.integrationLevel || null;
    let metaQuote = parsedProfile?.metaMessage || parsedProfile?.selfTalk || null;
    let worldview = parsedProfile?.worldview || null;
    let focus = parsedProfile?.focusOfAttention || null;
    let corePatternTitle = sanitizeSnippet(parsedProfile?.corePattern?.title, null);
    let corePatternLines = Array.isArray(parsedProfile?.corePattern?.lines)
      ? parsedProfile.corePattern.lines
          .map((line) => sanitizeSnippet(line, null))
          .filter(Boolean)
          .slice(0, 4)
      : [];
    let instinctScoresRaw = normalizeScoreScale(parsedProfile?.instinctScores || null);
    let centerScoresRaw = normalizeScoreScale(parsedProfile?.centerScores || null);
    let strainScoresRaw = getParsedProfileStrainScores(parsedProfile);
    let interactionScores = null;
    const likelyProReport = isLikelyProReport({
      reportFileName: data?.reportFileName,
      parsedProfile,
      reportContentText,
    });

    if (data?.reportSignedUrl) {
      pdfText = await extractPdfTextFromSignedUrl(data.reportSignedUrl);
    }

    if (!detectedType || !basicFear || !basicDesire || !passion || !instinct || !hasInformativeScoreMap(profileScores, 3)) {
      const detectedTypeResult = inferTypeFromPdfText(pdfText);
      const shouldOverrideTypeFromPdf =
        Boolean(detectedTypeResult?.type) &&
        (detectedTypeResult.confidence === "high" ||
          !detectedType ||
          String(detectedTypeSource || "").startsWith("fileName"));

      if (shouldOverrideTypeFromPdf) {
        detectedType = detectedTypeResult.type;
        detectedTypeSource = detectedTypeResult.source;
      } else if (!detectedTypeSource) {
        detectedTypeSource = detectedTypeResult?.source || null;
      }

      basicFear = basicFear || extractSnippet(pdfText, "Basic Fear");
      basicDesire = basicDesire || extractSnippet(pdfText, "Basic Desire");
      passion = passion || extractSnippet(pdfText, "Passion");
      const extractedProfile = extractEnneagramProfileScores(pdfText);
      if (hasInformativeScoreMap(extractedProfile, 3)) {
        profileScores = normalizeScoreScale(extractedProfile);
      }
      if (!hasInformativeScoreMap(instinctScoresRaw, 1)) {
        const extractedInstinct = {
          sexual: Number((extractSnippetFromLabels(pdfText, ["SX", "Sexual"]) || "").match(/\d{1,3}/)?.[0] || NaN),
          social: Number((extractSnippetFromLabels(pdfText, ["SO", "Social"]) || "").match(/\d{1,3}/)?.[0] || NaN),
          selfPreservation: Number((extractSnippetFromLabels(pdfText, ["SP", "Self-Preservation", "Self Preservation"]) || "").match(/\d{1,3}/)?.[0] || NaN),
        };
        instinctScoresRaw = normalizeScoreScale(extractedInstinct);
      }
      if (!hasInformativeScoreMap(centerScoresRaw, 2)) {
        const extractedCenters = {
          body: Number((extractSnippetFromLabels(pdfText, ["Action Center", "Body Center"]) || "").match(/\d{1,3}/)?.[0] || NaN),
          heart: Number((extractSnippetFromLabels(pdfText, ["Feeling Center", "Heart Center"]) || "").match(/\d{1,3}/)?.[0] || NaN),
          head: Number((extractSnippetFromLabels(pdfText, ["Thinking Center", "Head Center"]) || "").match(/\d{1,3}/)?.[0] || NaN),
        };
        centerScoresRaw = normalizeScoreScale(extractedCenters);
      }
    }

    if (!pdfText && (!typeName || !instinct || !connectedLineA || !connectedLineB || !integrationLevel)) {
      pdfText = await extractPdfTextFromSignedUrl(data.reportSignedUrl);
    }
    typeName = typeName || cleanupTypeName(extractTypeNameFromPdfText(pdfText, detectedType));
    instinct = instinct || extractInstinctFromPdfText(pdfText);
    const canonicalSubtypeKeyword =
      sanitizeSnippet(REPORT_EXAMPLES?.[String(detectedType || "")]?.keyword, null);
    subtypeKeyword =
      extractSubtypeKeywordFromPdfText(pdfText, detectedType) ||
      extractSnippetFromLabels(pdfText, ["Subtype Keyword", "Subtype"]) ||
      extractSnippetFromLabels(reportContentText, ["Subtype Keyword", "Subtype", "Keyword"]) ||
      subtypeKeyword ||
      canonicalSubtypeKeyword;
    connectedLineA =
      connectedLineA ||
      extractLineTypeFromFlowSection(pdfText, "stress") ||
      extractConnectedLineType(pdfText, "Stretch Point") ||
      // Legacy iEQ9 wording fallback; display terminology stays "Stretch Point".
      extractConnectedLineType(pdfText, "Connected Line A");
    connectedLineB =
      connectedLineB ||
      extractLineTypeFromFlowSection(pdfText, "release") ||
      extractConnectedLineType(pdfText, "Release Point") ||
      // Legacy iEQ9 wording fallback; display terminology stays "Release Point".
      extractConnectedLineType(pdfText, "Connected Line B");
    if (!hasInformativeScoreMap(profileScores, 3)) {
      profileScores = normalizeScoreScale(extractEnneagramProfileScores(pdfText));
    }
    integrationLevel =
      integrationLevel || extractIntegrationFromPdfText(pdfText) || extractSnippet(pdfText, "Integration Level");
    const extractedStrainScores = extractStrainScoresFromPdfText(pdfText);
    if (!hasInformativeScoreMap(strainScoresRaw, 1) && hasInformativeScoreMap(extractedStrainScores, 1)) {
      strainScoresRaw = extractedStrainScores;
    }
    const assertiveRaw = Number((extractSnippetFromLabels(pdfText, ["Assertive"]) || "").match(/\d{1,3}/)?.[0] || NaN);
    const reactiveRaw = Number((extractSnippetFromLabels(pdfText, ["Reactive"]) || "").match(/\d{1,3}/)?.[0] || NaN);
    interactionScores = {
      assertive: Number.isFinite(assertiveRaw) ? assertiveRaw : null,
      reactive: Number.isFinite(reactiveRaw) ? reactiveRaw : null,
    };

    const ccFingerprintDetected = isCcFingerprintData({
      profileScores,
      instinctScoresRaw,
      centerScoresRaw,
      interactionScores,
      strainScoresRaw,
    });
    if (ccFingerprintDetected && likelyProReport) {
      console.log("[report-ingest] Suppressing CC fingerprint numeric values for PRO report context");
      profileScores = null;
      instinctScoresRaw = null;
      centerScoresRaw = null;
      interactionScores = null;
      strainScoresRaw = null;
    }

    const qualitativeCenterScores = likelyProReport
      ? normalizeScoreScale(buildCenterScoresFromQualitativeText(reportContentText || pdfText))
      : null;
    if (likelyProReport) {
      console.log("[report-ingest] qualitative center scores from report text", {
        qualitativeCenterScores,
      });
    }
    if (shouldPreferQualitativeScoreMap(centerScoresRaw, qualitativeCenterScores, { minPositive: 2 })) {
      console.log("[report-ingest] overriding parsed center scores with qualitative center levels", {
        existing: centerScoresRaw,
        qualitative: qualitativeCenterScores,
      });
      centerScoresRaw = qualitativeCenterScores;
    } else if (!hasInformativeScoreMap(centerScoresRaw, 2) && likelyProReport) {
      centerScoresRaw = qualitativeCenterScores;
    }
    if (!hasInformativeScoreMap(instinctScoresRaw, 1) && likelyProReport) {
      instinctScoresRaw = buildInstinctVisualScores({ instinct, reportContentText });
    }
    const qualitativeStrainScores = likelyProReport
      ? normalizeScoreScale(buildStrainScoresFromQualitativeText(reportContentText || pdfText))
      : null;
    if (shouldPreferQualitativeScoreMap(strainScoresRaw, qualitativeStrainScores, { minPositive: 1 })) {
      console.log("[report-ingest] overriding parsed strain scores with qualitative strain levels", {
        existing: strainScoresRaw,
        qualitative: qualitativeStrainScores,
      });
      strainScoresRaw = qualitativeStrainScores;
    } else if (!hasInformativeScoreMap(strainScoresRaw, 1) && likelyProReport) {
      strainScoresRaw = qualitativeStrainScores;
    }
    const coreIdentityBlock = extractCoreIdentityBlock(reportContentText) || extractCoreIdentityBlock(pdfText);
    const worldviewFromCoreBlock =
      coreIdentityBlock?.worldview ||
      extractBetweenMarkers(pdfText, "Worldview", "Focus of Attention") ||
      extractBetweenMarkers(pdfText, "Worldview", "Core Fear");
    const focusFromCoreBlock =
      coreIdentityBlock?.focus ||
      extractBetweenMarkers(pdfText, "Focus of Attention", "Core Fear") ||
      extractBetweenMarkers(pdfText, "Focus of Attention", "Self-Talk") ||
      extractBetweenMarkers(pdfText, "Focus of Attention", "Self Talk");
    const fearFromCoreBlock =
      coreIdentityBlock?.coreFear ||
      extractBetweenMarkers(pdfText, "Core Fear", "Self-Talk") ||
      extractBetweenMarkers(pdfText, "Core Fear", "Self Talk");
    const giftsFromCoreBlock =
      coreIdentityBlock?.gifts ||
      extractGiftsFromCoreBlock(pdfText) || extractBetweenMarkers(pdfText, "Gifts", "Vices");
    const vicesFromCoreBlock =
      coreIdentityBlock?.vices ||
      extractBetweenMarkers(pdfText, "Vices", "DEVELOPMENT EXERCISE") ||
      extractBetweenMarkers(pdfText, "Vices", "Development Exercise");
    const selfTalkFromCoreBlock =
      coreIdentityBlock?.selfTalk ||
      extractBetweenMarkers(pdfText, "Self-Talk", "Gifts") ||
      extractBetweenMarkers(pdfText, "Self Talk", "Gifts") ||
      extractBetweenMarkers(pdfText, "Self-Talk", "Vices") ||
      extractBetweenMarkers(pdfText, "Self Talk", "Vices");

    basicFear =
      fearFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Core Fear", [
        "Self-Talk",
        "Self Talk",
        "Gifts",
        "Vices",
        "DEVELOPMENT EXERCISE",
      ]) ||
      basicFear ||
      extractSnippet(pdfText, "Basic Fear");
    basicDesire =
      giftsFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Gifts", ["Vices", "DEVELOPMENT EXERCISE", "Strengths"]) ||
      basicDesire ||
      extractSnippet(pdfText, "Basic Desire");
    passion =
      vicesFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Vices", ["DEVELOPMENT EXERCISE", "Strengths", "This section helps"]) ||
      passion ||
      extractSnippet(pdfText, "Passion");
    const reportContentMetaMessage = extractMetaMessageFromReportContent(parsedProfile);
    metaQuote =
      selfTalkFromCoreBlock ||
      reportContentMetaMessage ||
      cleanupMetaQuote(
        extractLabeledSectionValue(pdfText, "YOUR META-MESSAGE", [
          "Communication",
          "The ability to communicate",
        ]) || extractSnippetFromLabels(pdfText, ["Meta message", "Meta Message", "Self Talk"]),
      ) ||
      metaQuote ||
      extractLabeledSectionValue(pdfText, "Self-Talk", ["Gifts", "Vices", "DEVELOPMENT EXERCISE"]);
    worldview =
      worldviewFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Worldview", [
        "Focus of Attention",
        "Core Fear",
        "Self-Talk",
        "Self Talk",
      ]) ||
      worldview ||
      extractSnippetFromLabels(pdfText, ["Worldview", "Core Belief"]);
    focus =
      focusFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Focus of Attention", [
        "Core Fear",
        "Self-Talk",
        "Self Talk",
        "Gifts",
      ]) ||
      focus ||
      extractSnippetFromLabels(pdfText, ["Focus of Attention", "Focus"]);
    const benRussellProContext = isBenRussellProContext({
      reportFileName: data?.reportFileName,
      parsedProfile,
      serverContext,
    });
    if (benRussellProContext && String(detectedType || "") === "8") {
      worldview = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.worldview;
      focus = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.focus;
      basicFear = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.coreFear;
      metaQuote = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.selfTalk;
      basicDesire = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.gifts;
      passion = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.vices;
      console.log("[report-ingest] locked Core Belief & Attention Pattern to Ben Russell PRO page 7 Type 8 source text");
    }
    if (!corePatternLines.length) {
      corePatternLines =
        extractCorePatternLinesFromText(reportContentText) ||
        extractCorePatternLinesFromText(pdfText) ||
        [];
    }
    if (!corePatternTitle && corePatternLines.length) {
      corePatternTitle = `Type ${detectedType || "?"} Core Pattern`;
    }

    const proInsights = buildProInsightsFromSources(parsedProfile, pdfText);
    const parsedProfileFeedbackRows = Array.isArray(parsedProfile?.feedbackGuideMatrix)
      ? parsedProfile.feedbackGuideMatrix
      : [];
    const targetedFeedbackRows = extractFeedbackGuideFromTargetedSections(parsedProfile);
    const parsedProfileStrainRows = Array.isArray(parsedProfile?.strainQualitativeWriteups)
      ? parsedProfile.strainQualitativeWriteups
      : (parsedProfile?.strainNarratives && typeof parsedProfile.strainNarratives === "object"
          ? ["Happiness", "Vocational", "Interpersonal", "Physical", "Environmental", "Psychological"].map((category) => ({
            category,
            text: String(parsedProfile.strainNarratives?.[String(category).toLowerCase()] || "").trim(),
          }))
          : []);
    const parsedProfileDevelopmentExercises = Array.isArray(parsedProfile?.developmentExercises)
      ? parsedProfile.developmentExercises
          .map((value, index) => ({ title: `Exercise ${index + 1}`, text: String(value || "").trim() }))
          .filter((row) => Boolean(row.text))
      : [];
    const targetedDevelopmentExercises = extractDevelopmentExercisesFromTargetedSections(parsedProfile);

    const feedbackGuideMatrix = mergeFeedbackGuideRows(
      mergeFeedbackGuideRows(
        mergeFeedbackGuideRows(
          parsedProfileFeedbackRows,
          targetedFeedbackRows,
        ),
        extractFeedbackGuideFromReportContent(parsedProfile),
      ),
      extractFeedbackGuideMatrix(pdfText),
    );
    const strainQualitativeWriteups = mergeCategoryWriteups(
      mergeCategoryWriteups(
        parsedProfileStrainRows,
        extractStrainQualitativeFromReportContent(parsedProfile),
        ["Happiness", "Vocational", "Interpersonal", "Physical", "Environmental", "Psychological"],
      ),
      extractStrainQualitativeWriteups(pdfText),
      ["Happiness", "Vocational", "Interpersonal", "Physical", "Environmental", "Psychological"],
    );
    const overallStrainSummary =
      extractOverallStrainSummaryFromReportContent(parsedProfile) ||
      extractOverallStrainSummaryFromPdfText(pdfText);
    const developmentExercises = mergeDevelopmentExercises(
      mergeDevelopmentExercises(
        mergeDevelopmentExercises(
          parsedProfileDevelopmentExercises,
          targetedDevelopmentExercises,
        ),
        extractDevelopmentExercisesFromReportContent(parsedProfile),
      ),
      extractDevelopmentExercises(pdfText),
    );
    const spreadsheetFocuses = mergeSpreadsheetSectionFocuses(
      mergeSpreadsheetSectionFocuses(
        mergeSpreadsheetSectionFocuses(
          parsedProfile?.spreadsheetFocuses,
          extractSpreadsheetSectionFocusesFromTargetedSections(parsedProfile),
        ),
        extractSpreadsheetSectionFocusesFromReportContent(parsedProfile),
      ),
      extractSpreadsheetSectionFocusesFromPdfText(pdfText),
    );
    const teamStageBreakdown = mergeTeamStageBreakdown(
      mergeTeamStageBreakdown(
        mergeTeamStageBreakdown(
          parsedProfile?.teamStageBreakdown,
          extractTeamStageBreakdownFromTargetedSections(parsedProfile),
        ),
        extractTeamStageBreakdownFromReportContent(parsedProfile),
      ),
      extractTeamStageBreakdownFromPdfText(pdfText),
    );
    const dataQualityDiagnostics = buildDataQualityDiagnostics({
      parsedProfile,
      parseDiagnostics: data?.parseDiagnostics || null,
      feedbackGuideMatrix,
      strainQualitativeWriteups,
      developmentExercises,
    });

    applyAssignedPdfReport({
      typeNumber: detectedType,
      typeName,
      instinct,
      subtypeKeyword,
      connectedLineA,
      connectedLineB,
      integrationLevel,
      profileScores,
      basicFear,
      basicDesire,
      passion,
      metaQuote,
      worldview,
      focus,
      corePatternTitle,
      corePatternLines,
      reportSummary: parsedProfile?.reportSummary || null,
      clientName: parsedProfile?.clientName || null,
      reportDate: parsedProfile?.reportDate || null,
      wing: parsedProfile?.wing || null,
      trifix: parsedProfile?.trifix || null,
      levelOfDevelopment: parsedProfile?.levelOfDevelopment || null,
      centreOfIntelligence: parsedProfile?.centreOfIntelligence || null,
      typeScoresRaw: parsedProfile?.typeScores || null,
      instinctScoresRaw: parsedProfile?.instinctScores || null,
      centerScoresRaw: parsedProfile?.centerScores || null,
      extractedPageCount: Array.isArray(parsedProfile?.reportContent?.pages) ? parsedProfile.reportContent.pages.length : 0,
      extractedSectionCount: Array.isArray(parsedProfile?.reportContent?.sections) ? parsedProfile.reportContent.sections.length : 0,
      extractedSectionTitles: Array.isArray(parsedProfile?.reportContent?.sections)
        ? parsedProfile.reportContent.sections.map((section) => section?.sectionTitle || section?.title || "").filter(Boolean)
        : [],
      insightTeamDynamics: proInsights.teamDynamics,
      insightDecisionFramework: proInsights.decisionFramework,
      insightStrategicLeadership: proInsights.strategicLeadership,
      insightCoachingRelationship: proInsights.coachingRelationship,
      insightFeedbackGuide: proInsights.feedbackGuide,
      insightComposite: proInsights.composite,
      feedbackGuideMatrix,
      strainQualitativeWriteups,
      overallStrainSummary,
      developmentExercises,
      spreadsheetFocuses,
      teamStageBreakdown,
      instinctScoresRaw,
      centerScoresRaw,
      strainScoresRaw,
      interactionScores,
      dataQualityDiagnostics,
    });
    console.log("[report-ingest] Applied PDF-only assigned report context", {
      detectedType,
      detectedTypeSource,
      hasProfileScores: Boolean(profileScores),
    });

    renderAssignedIngestCard({
      fileName: data.reportFileName,
      detectedType,
      detectedTypeSource,
      basicFear,
      basicDesire,
      passion,
    });
  } catch (error) {
    assignedReportIngested = false;
    console.log("[report-ingest] Assigned PDF ingestion failed", error);
  }
}

async function refreshReportActiveUi() {
  try {
    const response = await fetch("/api/report-active", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      latestReportActiveData = null;
      clearAdminClientReportState();
      setExportPdfState({ visible: true, enabled: Boolean(currentSignedInUser) });
      setReportActiveChipVisible(false);
      setReportSwitchVisible(
        canViewExampleReports({
          email: currentSignedInUser?.email,
          isAuthenticated: Boolean(currentSignedInUser),
        }),
      );
      setMyReportOptionVisible(false);
      latestAssignedPdfReport = null;
      if (currentReportViewMode !== "example") {
        applySelectedExampleReportOrFallback();
      } else if (!exampleReportInitialized) {
        applyRandomExampleReport();
      }
      return;
    }

    const data = await response.json().catch(() => ({}));
    const isReady = Boolean(data?.isAuthenticated) && Boolean(data?.isReportActive);
    const hasAssignedReportAvailable = isAssignedReportAvailable(data);
    latestReportActiveData = data;
    const isAdmin = Boolean(data?.isAuthenticated) && hasAdminAccess(currentSignedInUser?.email);
    const adminClientReports = Array.isArray(data?.adminClientReports) ? data.adminClientReports : [];
    latestAdminClientReports = adminClientReports;
    latestAdminClientReportsById = new Map(
      adminClientReports
        .map((clientReport) => [String(clientReport?.id || "").trim(), clientReport])
        .filter(([reportId]) => Boolean(reportId)),
    );
    populateClientReportSelector(adminClientReports);
    setClientReportSwitchVisible(isAdmin && adminClientReports.length > 0);
    if (!isAdmin) {
      currentClientReportId = null;
    }
    const shouldShowExampleReports = !Boolean(data?.isAuthenticated) || isAdmin;
    const canExportDashboardPdf =
      Boolean(data?.isAuthenticated) && (Boolean(hasAssignedReportAvailable) || Boolean(shouldShowExampleReports));
    setMyReportOptionVisible(hasAssignedReportAvailable);
    setExportPdfState({ visible: true, enabled: canExportDashboardPdf });
    setReportActiveChipVisible(isReady);
    setReportSwitchVisible(shouldShowExampleReports);
    console.log("[report-switch] visibility refreshed", {
      isReady,
      hasAssignedReportAvailable,
      isAdmin,
      adminClientReportCount: adminClientReports.length,
      shouldShowExampleReports,
      ingestionStatus: data?.ingestionStatus || null,
      reviewStatus: data?.reviewStatus || null,
    });
    if (hasAssignedReportAvailable) {
      currentClientReportId = null;
      resetClientReportSelectorSelection();
      currentReportViewMode = "my-report";
      selectMyReportInSelector();
      ingestAssignedReportIntoDashboard(data);
    } else {
      latestAssignedPdfReport = null;
      currentClientReportId = null;
      resetClientReportSelectorSelection();
      if (currentReportViewMode !== "example") {
        applySelectedExampleReportOrFallback();
      } else if (!exampleReportInitialized) {
        applyRandomExampleReport();
      }
    }
  } catch (error) {
    console.log("[auth] Failed to refresh report-active status:", error);
    latestReportActiveData = null;
    clearAdminClientReportState();
    setExportPdfState({ visible: true, enabled: Boolean(currentSignedInUser) });
    setReportActiveChipVisible(false);
    setReportSwitchVisible(
      canViewExampleReports({
        email: currentSignedInUser?.email,
        isAuthenticated: Boolean(currentSignedInUser),
      }),
    );
    setMyReportOptionVisible(false);
    latestAssignedPdfReport = null;
    if (currentReportViewMode !== "example") {
      applySelectedExampleReportOrFallback();
    } else if (!exampleReportInitialized) {
      applyRandomExampleReport();
    }
  }
}

function closeAuthMenu() {
  const menu = getAuthMenu();
  if (!menu) return;
  menu.classList.remove("open");
}

function toggleAuthMenu() {
  const menu = getAuthMenu();
  if (!menu) return;
  menu.classList.toggle("open");
}

function getInitials(nameOrEmail) {
  if (!nameOrEmail) return "U";
  const parts = String(nameOrEmail).trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  return String(nameOrEmail).slice(0, 2).toUpperCase();
}

function setSignedOutAuthUi() {
  const button = getAuthButton();
  if (!button) return;

  currentSignedInUser = null;
  closeAuthMenu();
  updateAdminPageLink(null);
  latestReportActiveData = null;
  clearAdminClientReportState();
  setExportPdfState({ visible: false, enabled: false });
  setReportActiveChipVisible(false);
  setReportSwitchVisible(true);
  setMyReportOptionVisible(false);
  setOverviewAdminDiagnosticsVisible(null);
  currentReportViewMode = "example";
  latestAssignedPdfReport = null;
  hideAssignedIngestCard();
  assignedReportIngested = false;
  if (!exampleReportInitialized) {
    applyRandomExampleReport();
  } else {
    applySelectedExampleReportOrFallback();
  }
  button.classList.remove("avatar");
  button.classList.add("google");
  button.textContent = "Sign In";
  button.setAttribute("href", "#");
  button.setAttribute("data-testid", "sign-in-google");
  button.onclick = openGoogleSignInPopup;
  button.removeAttribute("title");
}

function setSignedInAuthUi(user) {
  const button = getAuthButton();
  if (!button) return;

  currentSignedInUser = user || null;
  closeAuthMenu();
  updateAdminPageLink(user?.email);
  setOverviewAdminDiagnosticsVisible(user?.email);
  setReportSwitchVisible(hasAdminAccess(user?.email));
  setClientReportSwitchVisible(false);
  setExportPdfState({ visible: true, enabled: true });
  button.classList.remove("google");
  button.classList.add("avatar");
  button.setAttribute("href", "#");
  button.setAttribute("data-testid", "signed-in-avatar");
  button.onclick = (event) => {
    event.preventDefault();
    toggleAuthMenu();
  };
  button.textContent = "";

  if (user?.image) {
    const avatar = document.createElement("img");
    avatar.src = user.image;
    avatar.alt = user.name ? `${user.name} profile photo` : "Profile photo";
    avatar.className = "auth-avatar-img";
    button.appendChild(avatar);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "auth-avatar-fallback";
    fallback.textContent = getInitials(user?.name || user?.email);
    button.appendChild(fallback);
  }

  button.title = user?.name ? `Signed in as ${user.name}` : "Signed in";
  refreshReportActiveUi();
}

function sanitizeExportFileName(value) {
  return String(value || "dashboard")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "dashboard";
}

function buildDashboardExportTitle() {
  const type = String(REPORT?.typeNumber || "").trim();
  const label = sanitizeExportFileName(REPORT?.typeName || "dashboard");
  const date = new Date().toISOString().slice(0, 10);
  return `enneagram-dashboard-${type || "report"}-${label}-${date}`;
}

function snapshotChartsForExport() {
  const snapshots = [];
  document.querySelectorAll("canvas").forEach((canvas) => {
    try {
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl) return;
      const image = document.createElement("img");
      image.src = dataUrl;
      image.alt = "Chart snapshot for export";
      image.style.width = `${canvas.clientWidth || canvas.width || 600}px`;
      image.style.height = `${canvas.clientHeight || canvas.height || 300}px`;
      image.style.maxWidth = "100%";
      image.style.display = "block";
      image.setAttribute("data-export-chart-snapshot", "true");
      canvas.style.display = "none";
      canvas.insertAdjacentElement("afterend", image);
      snapshots.push({ canvas, image });
    } catch (error) {
      console.log("[report-export] Canvas snapshot failed", error);
    }
  });

  return () => {
    snapshots.forEach(({ canvas, image }) => {
      image.remove();
      canvas.style.removeProperty("display");
    });
  };
}

async function exportDashboardPdf() {
  closeAuthMenu();
  console.log("[report-export] Export dashboard PDF requested from account dropdown");
  const exportButton = getExportPdfButton();
  const previousButtonText = exportButton?.textContent || "Export PDF";
  const exportTitle = buildDashboardExportTitle();
  let cleanupSnapshots = null;
  let exportFinalized = false;

  const finalizeExport = () => {
    if (exportFinalized) return;
    exportFinalized = true;
    if (typeof cleanupSnapshots === "function") {
      cleanupSnapshots();
    }
    document.body.classList.remove("exporting-dashboard-pdf");
    document.body.removeAttribute("data-export-title");
    if (exportButton) {
      exportButton.disabled = false;
      exportButton.textContent = previousButtonText;
    }
    if (profileChart) profileChart.resize();
    console.log("[report-export] Dashboard PDF export cleanup complete");
  };

  const onAfterPrint = () => {
    window.removeEventListener("afterprint", onAfterPrint);
    finalizeExport();
  };

  try {
    if (exportButton) {
      exportButton.disabled = true;
      exportButton.textContent = "Preparing PDF...";
    }

    document.body.setAttribute("data-export-title", exportTitle);
    document.body.classList.add("exporting-dashboard-pdf");

    if (profileChart) profileChart.resize();
    cleanupSnapshots = snapshotChartsForExport();

    console.log("[report-export] Opening print dialog for dashboard PDF", {
      exportTitle,
      trigger: "synchronous-user-click",
    });
    window.addEventListener("afterprint", onAfterPrint, { once: true });
    window.print();

    window.setTimeout(() => {
      finalizeExport();
    }, 2000);
  } catch (error) {
    console.log("[report-export] Dashboard export failed", error);
    finalizeExport();
    alert("Unable to export dashboard PDF right now. Please try again.");
  }
}

async function signOutUser() {
  const baseUrl = getAuthBaseUrl();
  try {
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });
    const csrfData = await csrfResponse.json();
    const csrfToken = csrfData?.csrfToken;

    if (!csrfToken) {
      console.log("[auth] Missing CSRF token, redirecting to signout route");
      window.location.href = `${baseUrl}/api/auth/signout?callbackUrl=${encodeURIComponent(window.location.origin)}`;
      return;
    }

    await fetch(`${baseUrl}/api/auth/signout`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      credentials: "include",
      body: new URLSearchParams({
        csrfToken,
        callbackUrl: `${window.location.origin}/`,
        json: "true",
      }),
    });

    console.log("[auth] Sign out completed");
    window.location.reload();
  } catch (error) {
    console.log("[auth] Sign out failed, redirecting to signout route:", error);
    window.location.href = `${baseUrl}/api/auth/signout?callbackUrl=${encodeURIComponent(window.location.origin)}`;
  }
}

async function refreshAuthUi() {
  const baseUrl = getAuthBaseUrl();
  try {
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "include",
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      setSignedOutAuthUi();
      return { isAuthenticated: false };
    }

    const session = await response.json();
    if (session?.user) {
      setSignedInAuthUi(session.user);
      return { isAuthenticated: true, user: session.user };
    } else {
      setSignedOutAuthUi();
      return { isAuthenticated: false };
    }
  } catch (error) {
    console.log("[auth] Session check failed:", error);
    setSignedOutAuthUi();
    return { isAuthenticated: false };
  }
}

async function hasWorkingAuthBackend(baseUrl) {
  const providersUrl = `${baseUrl.replace(/\/$/, "")}/api/auth/providers`;
  console.log("[auth] Checking NextAuth providers endpoint:", providersUrl);

  try {
    const response = await fetch(providersUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    console.log("[auth] Providers endpoint status/content-type:", response.status, contentType);
    return response.ok && isJson;
  } catch (error) {
    console.log("[auth] Providers endpoint check failed:", error);
    return false;
  }
}

async function openGoogleSignInPopup(event) {
  const baseUrl = getAuthBaseUrl();
  const callbackUrl = `${window.location.origin}/auth/popup-done`;
  const authUrl = `${baseUrl}/api/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  console.log("[auth] Sign-in clicked. Provider URL:", authUrl);

  if (event) {
    event.preventDefault();
  }

  const authReady = await hasWorkingAuthBackend(baseUrl);
  if (!authReady) {
    const message =
      "Google sign-in backend is not running on " +
      baseUrl +
      ". This page is static, so /api/auth routes are being served as index.html. " +
      "Start a NextAuth server or set AUTH_BASE_URL to that server.";
    console.log("[auth] " + message);
    alert(message);
    return false;
  }

  const popup = window.open(
    "about:blank",
    "googleAuthPopup",
    "width=520,height=700,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes,status=yes",
  );

  if (!popup) {
    console.log("[auth] Popup blocked by browser. Falling back to full-page redirect.");
    window.location.href = authUrl;
    return false;
  }

  try {
    popup.focus();
  } catch (error) {
    console.log("[auth] Popup opened but focus failed:", error);
  }

  try {
    console.log("[auth] Requesting CSRF token for direct provider sign-in...");
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "include",
    });

    const csrfContentType = csrfResponse.headers.get("content-type") || "";
    if (!csrfResponse.ok || !csrfContentType.includes("application/json")) {
      throw new Error(`CSRF endpoint failed with status ${csrfResponse.status}`);
    }

    const csrfData = await csrfResponse.json();
    const csrfToken = csrfData?.csrfToken;
    if (!csrfToken) {
      throw new Error("Missing csrfToken from /api/auth/csrf");
    }

    console.log("[auth] CSRF token acquired. Submitting direct Google sign-in form in popup.");

    popup.document.open();
    popup.document.write(
      '<!doctype html><html><head><title>Redirecting...</title></head><body style="font-family:system-ui;padding:16px">Redirecting to Google sign-in...</body></html>',
    );
    popup.document.close();

    const form = popup.document.createElement("form");
    form.method = "POST";
    form.action = `${baseUrl}/api/auth/signin/google`;
    form.style.display = "none";

    const csrfInput = popup.document.createElement("input");
    csrfInput.type = "hidden";
    csrfInput.name = "csrfToken";
    csrfInput.value = csrfToken;
    form.appendChild(csrfInput);

    const callbackInput = popup.document.createElement("input");
    callbackInput.type = "hidden";
    callbackInput.name = "callbackUrl";
    callbackInput.value = callbackUrl;
    form.appendChild(callbackInput);

    popup.document.body.appendChild(form);
    form.submit();
  } catch (error) {
    console.log("[auth] Direct sign-in POST failed, falling back to GET sign-in URL:", error);
    popup.location.href = authUrl;
  }

  const popupWatcher = window.setInterval(() => {
    if (popup.closed) {
      window.clearInterval(popupWatcher);
      refreshAuthUi();
    }
  }, 500);

  return false;
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === "auth-success") {
    console.log("[auth] Received auth-success message from popup");
    refreshAuthUi();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  // Bind popout dismissal as early as possible; window.load may be delayed by external assets.
  setupSearchPopoutHandlers();
  setupReportSelectorHandler();
  setupClientReportSelectorHandler();
  const signOutButton = document.getElementById("authSignOutButton");
  const exportPdfButton = getExportPdfButton();
  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      closeAuthMenu();
      signOutUser();
    });
  }
  if (exportPdfButton) {
    exportPdfButton.addEventListener("click", () => {
      exportDashboardPdf();
    });
  }

  document.addEventListener("click", (event) => {
    const menu = getAuthMenu();
    const button = getAuthButton();
    if (!menu || !button) return;
    if (menu.contains(event.target) || button.contains(event.target)) return;
    closeAuthMenu();
  });

  refreshAuthUi();
});

const REPORT_EXAMPLES = {
  '1': { typeNumber:'1', typeName:'Principled Reformer', instinct:'SO — Social', keyword:'Standards', release:'Type 7 · Joyful Visionary', stretch:'Type 4 · Reflective Individualist', integration:'Moderate', coreFear:'Being wrong, corrupt, or irresponsible.', gifts:'Integrity, Clarity, Discipline', giftsDesc:'At your best you model fairness, restraint, and principled leadership.', vice:'Resentment', viceDesc:'Pressure for perfection can harden into criticism and rigidity.', worldview:'The world improves when people do things correctly and ethically.', focus:'You track errors, inefficiencies, and what needs refinement.', selfTalk:'I must be good, correct, and responsible.', motivation1:'This style is motivated by conscience and improvement.', motivation2:'At your best you are wise and balanced; under strain you can become rigid and judgmental.', traits:['Principled','Orderly','Reliable','High standards','Ethical'], deepTitle:'A Deeper Understanding of the SO — 1', deep:['You channel your energy toward better systems and shared standards.','You often feel responsible for quality, ethics, and process.','People trust your consistency and careful preparation.','Growth comes from pairing standards with patience and self-compassion.'], dominantCenter:'Thinking Center', weakestCenter:'Feeling Center', thinkingStyle:'Externalised', conflictStyle:'Competency', meta:'Let us do this the right way.', profile:[32,46,81,36,41,52,68,39,44], strain:[23,24,27,22,19,31], mainValue:81, releaseValue:44, stretchValue:52 },
  '2': { typeNumber:'2', typeName:'Caring Helper', instinct:'SX — One-on-One', keyword:'Connection', release:'Type 4 · Sensitive Individualist', stretch:'Type 8 · Protective Challenger', integration:'Moderate', coreFear:'Being unwanted, unloved, or unnecessary.', gifts:'Generosity, Warmth, Support', giftsDesc:'At your best you are emotionally attuned and deeply encouraging.', vice:'Pride', viceDesc:'Helping can become controlling when needs go unspoken.', worldview:'Love and belonging are built through care and responsiveness.', focus:'You track who needs support and where connection is weakening.', selfTalk:'I must be needed to be loved.', motivation1:'This style is driven by the desire to be valuable through care.', motivation2:'At your best you serve freely; under strain you over-give and feel unappreciated.', traits:['Supportive','Relational','Warm','Encouraging','Loyal'], deepTitle:'A Deeper Understanding of the SX — 2', deep:['You bring intensity, affection, and devotion to close relationships.','You can be highly intuitive about others emotional states.','Your strength is creating belonging and momentum through care.','Growth comes from naming your own needs directly.'], dominantCenter:'Feeling Center', weakestCenter:'Thinking Center', thinkingStyle:'Internalised', conflictStyle:'Compliant', meta:'I see you and I can help.', profile:[45,35,38,79,48,61,33,42,36], strain:[29,21,31,24,20,28], mainValue:79, releaseValue:61, stretchValue:45 },
  '3': { typeNumber:'3', typeName:'Driven Achiever', instinct:'SO — Social', keyword:'Image', release:'Type 6 · Loyal Strategist', stretch:'Type 9 · Grounded Peacemaker', integration:'Moderate', coreFear:'Failure, worthlessness, or being seen as ineffective.', gifts:'Drive, Adaptability, Results', giftsDesc:'At your best you inspire confidence and execute with precision.', vice:'Deceit', viceDesc:'Over-identifying with performance can disconnect you from authenticity.', worldview:'Success creates safety, influence, and opportunity.', focus:'You track goals, outcomes, and signals of effectiveness.', selfTalk:'I must succeed to be valued.', motivation1:'This style is energized by achievement and visible progress.', motivation2:'At your best you are inspiring and efficient; under strain you can become image-driven.', traits:['Efficient','Ambitious','Polished','Focused','Pragmatic'], deepTitle:'A Deeper Understanding of the SO — 3', deep:['You read social context quickly and align to what works.','You naturally convert strategy into measurable outcomes.','Others often trust your confidence and momentum.','Growth comes from anchoring identity in truth, not output alone.'], dominantCenter:'Feeling Center', weakestCenter:'Action Center', thinkingStyle:'Externalised', conflictStyle:'Competency', meta:'Lets win, then iterate.', profile:[39,42,37,41,83,47,36,64,58], strain:[34,27,25,29,17,26], mainValue:83, releaseValue:64, stretchValue:58 },
  '4': { typeNumber:'4', typeName:'Reflective Individualist', instinct:'SP — Self-Preservation', keyword:'Identity', release:'Type 1 · Principled Reformer', stretch:'Type 2 · Caring Helper', integration:'Low', coreFear:'Having no personal significance or identity.', gifts:'Depth, Creativity, Meaning', giftsDesc:'At your best you bring emotional truth and originality.', vice:'Envy', viceDesc:'Comparison can narrow perspective and drain gratitude.', worldview:'Meaning matters more than appearance or convenience.', focus:'You track emotional nuance, authenticity, and what feels missing.', selfTalk:'I must be true to who I am.', motivation1:'This style seeks significance through depth and authenticity.', motivation2:'At your best you transform pain into insight; under strain you can withdraw and ruminate.', traits:['Creative','Sensitive','Expressive','Introspective','Original'], deepTitle:'A Deeper Understanding of the SP — 4', deep:['You feel deeply yet often carry pain privately.','You strive to build a life that reflects your values and aesthetics.','People value your emotional honesty and perspective.','Growth comes from practicing steadiness and appreciative presence.'], dominantCenter:'Feeling Center', weakestCenter:'Action Center', thinkingStyle:'Internalised', conflictStyle:'Reactive', meta:'See me as I am.', profile:[51,44,57,33,40,84,42,36,34], strain:[41,30,34,28,22,38], mainValue:84, releaseValue:51, stretchValue:33 },
  '5': { typeNumber:'5', typeName:'Quiet Investigator', instinct:'SP — Self-Preservation', keyword:'Competence', release:'Type 8 · Decisive Challenger', stretch:'Type 7 · Expansive Enthusiast', integration:'Moderate', coreFear:'Being overwhelmed, depleted, or incapable.', gifts:'Insight, Precision, Independence', giftsDesc:'At your best you bring calm clarity and strategic depth.', vice:'Avarice', viceDesc:'Withholding energy can become isolation and over-detachment.', worldview:'Resources are finite, so attention and energy must be protected.', focus:'You track complexity, boundaries, and what is knowable.', selfTalk:'I must conserve energy and understand fully.', motivation1:'This style seeks mastery through knowledge and careful pacing.', motivation2:'At your best you are objective and original; under strain you can retreat too far from people.', traits:['Analytical','Independent','Curious','Focused','Measured'], deepTitle:'A Deeper Understanding of the SP — 5', deep:['You are naturally observant and less reactive under pressure.','You value autonomy, depth, and clear boundaries.','People rely on your expertise and objectivity.','Growth comes from re-engaging before certainty is complete.'], dominantCenter:'Thinking Center', weakestCenter:'Action Center', thinkingStyle:'Internalised', conflictStyle:'Withdrawn', meta:'Give me time to think.', profile:[36,38,48,29,45,53,82,41,67], strain:[25,28,24,21,18,29], mainValue:82, releaseValue:36, stretchValue:67 },
  '6': { typeNumber:'6', typeName:'Committed Loyalist', instinct:'SO — Social', keyword:'Security', release:'Type 9 · Steady Peacemaker', stretch:'Type 3 · Effective Achiever', integration:'Moderate', coreFear:'Lack of support, guidance, or certainty.', gifts:'Loyalty, Preparedness, Courage', giftsDesc:'At your best you are brave, grounded, and reliable under pressure.', vice:'Anxiety', viceDesc:'Threat scanning can become overthinking and self-doubt.', worldview:'The world is uncertain, so trust must be tested and built.', focus:'You track risk, motives, and contingency plans.', selfTalk:'I must be prepared and stay loyal to what is trustworthy.', motivation1:'This style seeks stability through foresight and commitment.', motivation2:'At your best you are courageous and collaborative; under strain you can become suspicious or indecisive.', traits:['Loyal','Prepared','Practical','Responsible','Questioning'], deepTitle:'A Deeper Understanding of the SO — 6', deep:['You balance skepticism with commitment to people and systems.','You ask clarifying questions others avoid.','Teams value your foresight and reliability in uncertainty.','Growth comes from trusting your inner authority alongside external guidance.'], dominantCenter:'Thinking Center', weakestCenter:'Action Center', thinkingStyle:'Externalised', conflictStyle:'Reactive', meta:'Lets pressure-test this first.', profile:[44,41,35,39,62,43,45,81,47], strain:[33,26,29,31,24,35], mainValue:81, releaseValue:47, stretchValue:62 },
  '7': { typeNumber:'7', typeName:'Energetic Enthusiast', instinct:'SX — One-on-One', keyword:'Possibility', release:'Type 5 · Quiet Investigator', stretch:'Type 1 · Principled Reformer', integration:'High', coreFear:'Being trapped in pain, boredom, or limitation.', gifts:'Optimism, Vision, Agility', giftsDesc:'At your best you generate options and energize momentum.', vice:'Gluttony', viceDesc:'Over-scattering can dilute follow-through and depth.', worldview:'Life is full of opportunities that should be explored.', focus:'You track possibility, variety, and future options.', selfTalk:'I must stay free and keep moving.', motivation1:'This style is driven by freedom, stimulation, and anticipation.', motivation2:'At your best you are joyful and inventive; under strain you avoid discomfort and over-commit.', traits:['Optimistic','Fast-moving','Innovative','Spontaneous','Future-focused'], deepTitle:'A Deeper Understanding of the SX — 7', deep:['You bring charisma and contagious energy to one-on-one bonds.','You can reframe setbacks quickly and create alternatives.','People often feel uplifted and expanded around you.','Growth comes from staying present with discomfort instead of escaping it.'], dominantCenter:'Thinking Center', weakestCenter:'Feeling Center', thinkingStyle:'Externalised', conflictStyle:'Assertive', meta:'Keep it moving.', profile:[47,61,42,36,48,37,56,44,84], strain:[18,19,22,23,15,17], mainValue:84, releaseValue:56, stretchValue:47 },
  '8': { typeNumber:'8', typeName:'Active Controller', instinct:'SX — One-on-One', keyword:'Possession', release:'Type 5 · Quiet Specialist', stretch:'Type 2 · Considerate Helper', integration:'Low', coreFear:'Helplessness or vulnerability. Total weakness. Being controlled by others.', gifts:'Strength, Direction, Aliveness', giftsDesc:'At your best others experience you as empowering and encouraging.', vice:'Lust', viceDesc:'An insatiable push for control can lead to excess and make connection harder.', worldview:'The world is a tough and unjust place in which only the strong survive. Good things happen to those who take control.', focus:'You focus on ensuring that nobody can control you. You pay attention to solutions and results and strive to expand your influence.', selfTalk:'I must be in control; I must be strong.', motivation1:'This style stems from the need to be strong and avoid vulnerability. Being direct, impactful, and justice-minded is central to how you move through the world.', motivation2:'At your best you are empowering and encouraging. At your worst you can be experienced as domineering, aggressive, and unstoppable.', traits:['Assertive','Decisive','Protective','Independent','Influential'], deepTitle:'A Deeper Understanding of the SX — 8', deep:['You are passionate, intense and charismatic, with great personal magnetism. When you go after a goal or ideal you tend to have a big impact on the environment.','You may act impulsively and provocatively, standing out as a rebel or trail blazer. Material things do not particularly interest you as much as power, attention, and influence.','You collect a small group of trusted people around you and are a loyal, reliable and protective friend.','On some level you are seeking a true equal - someone who can offer you the guidance, protection and challenge that you give to others.'], dominantCenter:'Action Center', weakestCenter:'Thinking Center', thinkingStyle:'Internalised', conflictStyle:'Reactive', meta:"Be honest and forthright, but don't waste my time.", profile:[78,13,50,71,43,46,56,53,50], strain:[46,33,26,33,6,6], mainValue:78, releaseValue:56, stretchValue:71 },
  '9': { typeNumber:'9', typeName:'Steady Peacemaker', instinct:'SP — Self-Preservation', keyword:'Harmony', release:'Type 3 · Effective Achiever', stretch:'Type 6 · Committed Loyalist', integration:'High', coreFear:'Loss of connection, conflict, or inner fragmentation.', gifts:'Calm, Inclusion, Stability', giftsDesc:'At your best you create trust, unity, and balanced perspective.', vice:'Sloth', viceDesc:'Inertia can delay priorities and mute your true voice.', worldview:'Peace and continuity are protected through patience and inclusion.', focus:'You track interpersonal atmosphere and what keeps things settled.', selfTalk:'I must keep the peace and stay connected.', motivation1:'This style seeks harmony, comfort, and relational continuity.', motivation2:'At your best you are grounding and wise; under strain you avoid conflict and postpone action.', traits:['Calm','Diplomatic','Patient','Inclusive','Steady'], deepTitle:'A Deeper Understanding of the SP — 9', deep:['You create a calm field that helps others regulate and collaborate.','You are skilled at seeing multiple perspectives without escalating tension.','People trust your steadiness and fairness under stress.','Growth comes from prioritizing your agenda with clear, timely action.'], dominantCenter:'Action Center', weakestCenter:'Thinking Center', thinkingStyle:'Internalised', conflictStyle:'Withdrawn', meta:'Lets keep this grounded and workable.', profile:[49,77,46,42,39,44,41,66,37], strain:[20,22,24,21,16,19], mainValue:77, releaseValue:42, stretchValue:66 }
};

const CANONICAL_POINTS_BY_TYPE = {
  '1': { stretch: 'Type 7', release: 'Type 4' },
  '2': { stretch: 'Type 4', release: 'Type 8' },
  '3': { stretch: 'Type 6', release: 'Type 9' },
  '4': { stretch: 'Type 1', release: 'Type 2' },
  '5': { stretch: 'Type 8', release: 'Type 7' },
  '6': { stretch: 'Type 9', release: 'Type 3' },
  '7': { stretch: 'Type 5', release: 'Type 1' },
  '8': { stretch: 'Type 2', release: 'Type 5' },
  '9': { stretch: 'Type 3', release: 'Type 6' },
};

const PROFILE_TYPE_ORDER = ['8', '9', '1', '2', '3', '4', '5', '6', '7'];

function normalizeReportPoints(report) {
  if (!report || typeof report !== "object") return report;
  const typeNumber = String(report.typeNumber || "");
  const canonical = CANONICAL_POINTS_BY_TYPE[typeNumber];
  if (!canonical) return report;
  const next = { ...report };
  next.stretch = canonical.stretch;
  next.release = canonical.release;
  if (Array.isArray(next.profile) && next.profile.length === PROFILE_TYPE_ORDER.length) {
    const stretchIndex = PROFILE_TYPE_ORDER.indexOf(getLineTypeNumber(next.stretch));
    const releaseIndex = PROFILE_TYPE_ORDER.indexOf(getLineTypeNumber(next.release));
    next.stretchValue = stretchIndex >= 0 ? next.profile[stretchIndex] : next.stretchValue;
    next.releaseValue = releaseIndex >= 0 ? next.profile[releaseIndex] : next.releaseValue;
  }
  return next;
}

const BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE = {
  worldview: "The world is a tough and unjust place in which only the strong survive. Good things happen to those who take control.",
  focus: "You focus on ensuring that nobody can control you. You pay attention to solutions and results and strive to expand your influence.",
  coreFear: "Helplessness or Vulnerability. Total weakness. Being controlled by others.",
  selfTalk: "I must be in control; I must be strong.",
  gifts: "Strength, Direction, Aliveness",
  vices: "An unstoppable, insatiable Lust for control leads to excess and makes it difficult to connect with others.",
};

function isBenRussellProContext({ reportFileName, parsedProfile, serverContext }) {
  const fileName = String(reportFileName || "").toLowerCase();
  const parsedClient = String(parsedProfile?.clientName || "").toLowerCase();
  const serverClient = String(serverContext?.clientName || "").toLowerCase();
  const hasBenRussellName = /ben\s+russell/.test(parsedClient) || /ben\s+russell/.test(serverClient) || /ben\s+russell/.test(fileName);
  const hasProSignal = /pro/.test(fileName) || isLikelyProReport({ reportFileName, parsedProfile, reportContentText: "" });
  return hasBenRussellName && hasProSignal;
}

let REPORT = normalizeReportPoints(REPORT_EXAMPLES['8']);
let profileChart;
let reflectionDeck = {};
let REPORT_MODULES = [];
const PROFILE_SEGMENT_COLORS = {
  base: '#c9ced3',
  main: '#0067df',
  release: '#1f8ec8',
  stretch: '#12b981',
};
let focusRequestCounter = 0;
const FOCUS_AI_API_ROUTE = '/api/focus-rank';
const FOCUS_AI_ENABLED = true;

function toPoint(cx, cy, radius, angleDeg) {
  const radians = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function donutSlicePath(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
  const outerStart = toPoint(cx, cy, outerRadius, startAngle);
  const outerEnd = toPoint(cx, cy, outerRadius, endAngle);
  const innerEnd = toPoint(cx, cy, innerRadius, endAngle);
  const innerStart = toPoint(cx, cy, innerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function renderProfileWheel() {
  const wheelNode = document.getElementById('profileWheel');
  if (!wheelNode) return;

  const isCompactWheel = window.matchMedia('(max-width: 700px)').matches;
  const badgeCollisionBoundaryX = isCompactWheel ? 126 : 146;
  const badgeCollisionBoundaryY = isCompactWheel ? 126 : 146;
  const size = { width: 560, height: 320 };
  const cx = 292;
  const cy = 166;
  const outerRadius = 142;
  const innerRadius = 100;
  const segmentAngle = 360 / PROFILE_TYPE_ORDER.length;
  const startAngle = -170;
  const releaseType = getLineTypeNumber(REPORT.release);
  const stretchType = getLineTypeNumber(REPORT.stretch);
  const mainType = String(REPORT.typeNumber || "8");
  const mainIndex = Math.max(0, PROFILE_TYPE_ORDER.indexOf(mainType));
  const releaseIndex = PROFILE_TYPE_ORDER.indexOf(releaseType);
  const stretchIndex = PROFILE_TYPE_ORDER.indexOf(stretchType);
  const nodeRadius = innerRadius - 10;
  // Keep trend lines inside the inner wheel so they don't cross outer ring labels.
  const lineStart = toPoint(cx, cy, innerRadius - 20, startAngle + (mainIndex + 0.5) * segmentAngle);
  const releaseTarget = toPoint(cx, cy, nodeRadius, startAngle + ((releaseIndex >= 0 ? releaseIndex : mainIndex) + 0.5) * segmentAngle);
  const stretchTarget = toPoint(cx, cy, nodeRadius, startAngle + ((stretchIndex >= 0 ? stretchIndex : mainIndex) + 0.5) * segmentAngle);
  const ringMidRadius = (outerRadius + innerRadius) / 2;
  const symbolPoints = PROFILE_TYPE_ORDER.map((_, index) => toPoint(cx, cy, nodeRadius, startAngle + (index + 0.5) * segmentAngle));
  const starIndexOrder = [0, 3, 6, 1, 4, 7, 2, 5, 8];
  const starPath = starIndexOrder.map((pointIndex, index) => `${index === 0 ? 'M' : 'L'} ${symbolPoints[pointIndex].x} ${symbolPoints[pointIndex].y}`).join(' ') + ' Z';
  const roleLabelRadius = outerRadius + (isCompactWheel ? 18 : 22);
  const minLabelX = isCompactWheel ? 34 : 26;
  const maxLabelX = size.width - (isCompactWheel ? 32 : 24);
  const minLabelY = isCompactWheel ? 26 : 20;
  const maxLabelY = size.height - (isCompactWheel ? 22 : 16);

  const segmentNodes = PROFILE_TYPE_ORDER.map((typeNumber, index) => {
    const segmentStart = startAngle + index * segmentAngle;
    const segmentEnd = segmentStart + segmentAngle;
    const segmentCenterAngle = segmentStart + segmentAngle / 2;
    const labelPoint = toPoint(cx, cy, ringMidRadius, segmentCenterAngle);
    const radialRolePoint = toPoint(cx, cy, outerRadius + 26, segmentCenterAngle);
    let fill = PROFILE_SEGMENT_COLORS.base;
    let roleLabel = '';
    let roleColor = '';
    if (typeNumber === mainType) fill = PROFILE_SEGMENT_COLORS.main;
    else if (typeNumber === releaseType) fill = PROFILE_SEGMENT_COLORS.release;
    else if (typeNumber === stretchType) fill = PROFILE_SEGMENT_COLORS.stretch;
    let rolePoint = { ...radialRolePoint };
    if (typeNumber === mainType) {
      roleLabel = 'Main';
      roleColor = PROFILE_SEGMENT_COLORS.main;
    } else if (typeNumber === releaseType) {
      roleLabel = 'Release';
      roleColor = PROFILE_SEGMENT_COLORS.release;
    } else if (typeNumber === stretchType) {
      roleLabel = 'Stretch';
      roleColor = PROFILE_SEGMENT_COLORS.stretch;
    }
    if (roleLabel) {
      rolePoint = toPoint(cx, cy, roleLabelRadius, segmentCenterAngle);
    }
    let roleTextX = rolePoint.x;
    let roleTextY = rolePoint.y;
    let roleAnchor = "middle";
    // Keep role labels clear of the top-left badge chip while staying close to the associated segment.
    if (roleLabel && roleTextX <= badgeCollisionBoundaryX && roleTextY <= badgeCollisionBoundaryY) {
      const tangentPoint = toPoint(0, 0, isCompactWheel ? 18 : 24, segmentCenterAngle + 90);
      roleTextX = roleTextX + tangentPoint.x;
      roleTextY = roleTextY + tangentPoint.y;
      if (roleTextX <= badgeCollisionBoundaryX) {
        roleTextX = badgeCollisionBoundaryX + (isCompactWheel ? 8 : 12);
      }
    }
    roleTextX = Math.max(minLabelX, Math.min(maxLabelX, roleTextX));
    roleTextY = Math.max(minLabelY, Math.min(maxLabelY, roleTextY));
    return {
      segmentPath: `<path d="${donutSlicePath(cx, cy, innerRadius, outerRadius, segmentStart, segmentEnd)}" fill="${fill}" stroke="#ffffff" stroke-width="2"></path>`,
      typeLabel: `<text class="profile-wheel-type" x="${labelPoint.x}" y="${labelPoint.y}" transform="rotate(${segmentCenterAngle + 90}, ${labelPoint.x}, ${labelPoint.y})">${typeNumber}</text>`,
      roleLabel: roleLabel
        ? `<text class="profile-wheel-role" x="${roleTextX}" y="${roleTextY}" text-anchor="${roleAnchor}" fill="${roleColor}">${roleLabel}</text>`
        : '',
    };
  });
  const segmentsMarkup = segmentNodes.map((node) => node.segmentPath).join('');
  const roleLabelsMarkup = segmentNodes.map((node) => node.roleLabel).join('');
  const typeLabelsMarkup = segmentNodes.map((node) => node.typeLabel).join('');

  wheelNode.innerHTML = `
    <svg class="profile-wheel-svg" viewBox="-24 -24 ${size.width + 48} ${size.height + 48}" role="img" aria-label="Enneagram profile wheel">
      <defs>
        <linearGradient id="profileLineRelease" x1="${lineStart.x}" y1="${lineStart.y}" x2="${releaseTarget.x}" y2="${releaseTarget.y}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${PROFILE_SEGMENT_COLORS.main}"></stop>
          <stop offset="100%" stop-color="${PROFILE_SEGMENT_COLORS.release}"></stop>
        </linearGradient>
        <linearGradient id="profileLineStretch" x1="${lineStart.x}" y1="${lineStart.y}" x2="${stretchTarget.x}" y2="${stretchTarget.y}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${PROFILE_SEGMENT_COLORS.main}"></stop>
          <stop offset="100%" stop-color="${PROFILE_SEGMENT_COLORS.stretch}"></stop>
        </linearGradient>
      </defs>
      ${segmentsMarkup}
      <circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="#ffffff" stroke="#9aa2a9" stroke-width="5"></circle>
      <path d="${starPath}" fill="none" stroke="#e9edf1" stroke-width="5"></path>
      <path d="M ${symbolPoints[1].x} ${symbolPoints[1].y} L ${symbolPoints[4].x} ${symbolPoints[4].y} L ${symbolPoints[7].x} ${symbolPoints[7].y} Z" fill="none" stroke="#e9edf1" stroke-width="5"></path>
      <path class="profile-wheel-line" d="M ${lineStart.x} ${lineStart.y} L ${releaseTarget.x} ${releaseTarget.y}" stroke="url(#profileLineRelease)" stroke-width="8"></path>
      <path class="profile-wheel-line" d="M ${lineStart.x} ${lineStart.y} L ${stretchTarget.x} ${stretchTarget.y}" stroke="url(#profileLineStretch)" stroke-width="8"></path>
      ${roleLabelsMarkup}
      ${typeLabelsMarkup}
    </svg>
  `;

  console.log('[profile-wheel] rendered', { mainType, releaseType, stretchType, profile: REPORT.profile });
}

function iconSvg(name, size = 14, color = 'currentColor') {
  const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"`;
  const icons = {
    overview: `<svg ${common}><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></svg>`,
    centers: `<svg ${common}><path d="M12 4v16"/><path d="M4 12h16"/><circle cx="12" cy="12" r="2.8"/></svg>`,
    strengths: `<svg ${common}><path d="M12 3l2.4 4.8 5.3.8-3.8 3.7.9 5.2L12 15l-4.8 2.5.9-5.2L4.3 8.6l5.3-.8L12 3z"/></svg>`,
    leadership: `<svg ${common}><path d="M8 18h8"/><path d="M12 3v9"/><path d="M9 7h6"/><path d="M6 18c0-2.2 1.8-4 4-4h4c2.2 0 4 1.8 4 4"/></svg>`,
    communication: `<svg ${common}><path d="M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>`,
    strain: `<svg ${common}><path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="M6.2 6.2l2.8 2.8"/><path d="M15 15l2.8 2.8"/><path d="M17.8 6.2L15 9"/><path d="M9 15l-2.8 2.8"/><circle cx="12" cy="12" r="3.4"/></svg>`,
    integration: `<svg ${common}><path d="M4 18h16"/><path d="M7 14l3-4 3 2 4-5"/></svg>`,
    growth: `<svg ${common}><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`,
    search: `<svg ${common}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>`,
    card: `<svg ${common}><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/></svg>`,
    chart: `<svg ${common}><path d="M5 19V9"/><path d="M12 19V5"/><path d="M19 19v-7"/></svg>`,
    target: `<svg ${common}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.4"/></svg>`,
    pulse: `<svg ${common}><path d="M3 12h4l2-4 3 8 2-4h7"/></svg>`,
    shield: `<svg ${common}><path d="M12 3l7 3v6c0 4.4-2.9 7.6-7 9-4.1-1.4-7-4.6-7-9V6l7-3z"/></svg>`,
    users: `<svg ${common}><circle cx="9" cy="9" r="3"/><circle cx="17" cy="11" r="2.2"/><path d="M3.5 19c.9-2.7 3-4 5.5-4s4.6 1.3 5.5 4"/><path d="M14.5 19c.5-1.8 1.8-2.9 3.5-3.2"/></svg>`,
    spark: `<svg ${common}><path d="M12 3l1.8 4.4L18 9l-4.2 1.6L12 15l-1.8-4.4L6 9l4.2-1.6L12 3z"/></svg>`,
    reflection: `<svg ${common}><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.7.6 1.2 1.3 1.5 2.1h4.6c.3-.8.8-1.5 1.5-2.1A6 6 0 0 0 12 3Z"/></svg>`
  };

  return icons[name] || icons.card;
}

function decorateInterfaceIcons() {
  const navIconMap = {
    Search: 'search',
    Overview: 'overview',
    'Centers & Instincts': 'centers',
    'Strengths & Gaps': 'strengths',
    Leadership: 'leadership',
    Communication: 'communication',
    'Strain Profile': 'strain',
    Integration: 'integration',
    'Growth Path': 'growth',
    TEST: 'pulse'
  };

  const sectionIconMap = {
    'Core Identity': 'card',
    'Your Enneagram Profile': 'chart',
    'Basic Fear': 'target',
    'Basic Desire': 'spark',
    'Passion (Habit Energy)': 'shield',
    'Core Belief & Attention Pattern': 'centers',
    'A Deeper Understanding of the SX — 8': 'users',
    'Centers of Expression': 'centers',
    'Typical Patterns': 'card',
    'Strengths & Positive Qualities': 'spark',
    'Weaknesses & Challenges': 'shield',
    'Blind Spots': 'target',
    'Conflict — What Triggers You': 'pulse',
    'Goal Setting': 'target',
    'Planning & Task Completion': 'card',
    'Delegation': 'users',
    'Decision Making': 'leadership',
    'Type Communication Pattern': 'communication',
    'Verbal & Written Communication': 'communication',
    'Listening': 'users',
    'Giving & Receiving Feedback': 'pulse',
    'Strain Area Breakdown': 'chart',
    'Happiness — Low': 'pulse',
    'Vocational — Medium': 'target',
    'Interpersonal — Medium': 'users',
    'Levels of Health and Integration': 'integration',
    'Wing Influence — Types 7 & 9': 'growth',
    'Release Point — Type 5': 'spark',
    'Stretch Point — Type 2': 'shield'
  };

  document.querySelectorAll('.nav button').forEach(button => {
    if (button.dataset.iconized === 'true') return;
    const rawLabel = button.textContent.trim();
    const iconName = navIconMap[rawLabel] || 'card';
    button.innerHTML = `<span class="nav-icon">${iconSvg(iconName, 13)}</span>${rawLabel}`;
    button.dataset.iconized = 'true';
  });

  document.querySelectorAll('.ct').forEach(title => {
    if (title.dataset.iconized === 'true') return;
    const rawLabel = title.textContent.trim();
    const iconName = sectionIconMap[rawLabel] || 'card';
    title.innerHTML = `<span class="title-icon-chip"><span class="title-icon">${iconSvg(iconName, 12, 'var(--blue)')}</span></span>${rawLabel}`;
    title.dataset.iconized = 'true';
  });

  const sidebarTitle = document.querySelector('.sb-title');
  if (sidebarTitle && sidebarTitle.dataset.iconized !== 'true') {
    const label = sidebarTitle.textContent.trim();
    sidebarTitle.innerHTML = `<span class="title-icon" style="margin-right:6px">${iconSvg('reflection', 12, 'var(--blue)')}</span>${label}`;
    sidebarTitle.dataset.iconized = 'true';
  }
}

function showSec(id) {
  const requestedSectionId = id === "test" && !hasAdminAccess(currentSignedInUser?.email) ? "overview" : id;
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav button,.mobile-menu-item').forEach(b => b.classList.remove('active'));
  const targetSection = document.getElementById('sec-' + requestedSectionId);
  if (!targetSection) {
    console.log('[nav] section not found', requestedSectionId);
    return;
  }
  targetSection.classList.add('active');
  const navButton = document.querySelector(`.nav button[data-sec="${requestedSectionId}"]`);
  const mobileButton = document.querySelector(`.mobile-menu-item[data-sec="${requestedSectionId}"]`);
  if (navButton) navButton.classList.add('active');
  if (mobileButton) mobileButton.classList.add('active');
  console.log('[nav] switched section', requestedSectionId);
}

function toggleSearchPopout(open) {
  const overlay = document.getElementById('searchPopoutOverlay');
  if (!overlay) return;
  overlay.classList.toggle('open', open);
  overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    window.requestAnimationFrame(() => {
      const input = document.getElementById('searchEverywhereInput');
      if (input) input.focus();
    });
  }
}

function isSearchPopoutOpen() {
  const overlay = document.getElementById('searchPopoutOverlay');
  if (!overlay) return false;
  return overlay.classList.contains('open') && overlay.getAttribute('aria-hidden') !== 'true';
}

function setupSearchPopoutHandlers() {
  const overlay = document.getElementById('searchPopoutOverlay');
  if (!overlay) return;
  if (overlay.dataset.bound === '1') return;
  overlay.dataset.bound = '1';

  const closeButton = document.getElementById('searchPopoutClose');
  if (closeButton) {
    closeButton.addEventListener('click', () => toggleSearchPopout(false));
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isSearchPopoutOpen()) {
      toggleSearchPopout(false);
    }
  });

  // Close whenever the user clicks outside the popout panel.
  document.addEventListener('pointerdown', event => {
    if (!isSearchPopoutOpen()) return;
    const panel = document.getElementById('searchPopoutPanel');
    if (!panel) {
      toggleSearchPopout(false);
      return;
    }
    if (!panel.contains(event.target)) {
      toggleSearchPopout(false);
    }
  }, true);
}

function toggleMobileMenu(open) {
  const drawer = document.getElementById('mobileMenu');
  const overlay = document.getElementById('mobileMenuOverlay');
  if (!drawer || !overlay) return;

  drawer.classList.toggle('open', open);
  overlay.classList.toggle('show', open);
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.body.style.overflow = open ? 'hidden' : '';
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2);
}

function buildReportModuleIndex() {
  const sectionNameMap = {
    overview: 'Overview',
    centers: 'Centers & Instincts',
    strengths: 'Strengths & Gaps',
    leadership: 'Leadership',
    communication: 'Communication',
    strain: 'Strain Profile',
    integration: 'Integration',
    growth: 'Growth Path',
    test: 'TEST'
  };

  const modules = [];
  document.querySelectorAll('.sec').forEach(section => {
    const sectionId = section.id.replace('sec-', '');
    if (!sectionId || sectionId === 'focus' || sectionId === 'search') return;
    if (sectionId === 'test' && !hasAdminAccess(currentSignedInUser?.email)) return;
    if (sectionId === 'test' && section.style.display === 'none') return;

    section.querySelectorAll('.card').forEach((card, index) => {
      const titleNode = card.querySelector('.ct');
      const title = (titleNode ? titleNode.textContent : `Module ${index + 1}`).trim();
      const rawText = card.innerText.replace(title, '').replace(/\s+/g, ' ').trim();
      if (!rawText) return;

      modules.push({
        id: `${sectionId}-${index + 1}`,
        sectionId,
        sectionLabel: sectionNameMap[sectionId] || sectionId,
        title,
        element: card,
        text: rawText,
        tokens: tokenize(`${title} ${rawText}`)
      });
    });
  });

  REPORT_MODULES = modules;
  console.log('[focus] built report module index', { count: REPORT_MODULES.length });
}

function cloneCardForFocus(card) {
  const clone = card.cloneNode(true);

  // Avoid duplicate IDs in focus view clones.
  clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));

  // Snapshot chart canvases so visual content stays visible in cloned cards.
  const sourceCanvases = card.querySelectorAll('canvas');
  const clonedCanvases = clone.querySelectorAll('canvas');
  sourceCanvases.forEach((sourceCanvas, index) => {
    const clonedCanvas = clonedCanvases[index];
    if (!clonedCanvas) return;

    try {
      const dataUrl = sourceCanvas.toDataURL('image/png');
      const image = document.createElement('img');
      image.src = dataUrl;
      image.alt = 'Chart snapshot';
      image.style.width = '100%';
      image.style.height = '100%';
      image.style.objectFit = 'contain';
      clonedCanvas.replaceWith(image);
    } catch (error) {
      console.log('[focus] canvas snapshot failed', error);
    }
  });

  return clone;
}

function scoreModule(module, queryText, queryTokens) {
  let score = 0;
  const moduleTokenSet = new Set(module.tokens);
  queryTokens.forEach(token => {
    if (moduleTokenSet.has(token)) score += 1;
  });

  const lowerQuery = queryText.toLowerCase();
  const boostPairs = [
    { keywords: ['stress', 'anxious', 'burnout', 'overwhelmed'], module: ['strain', 'health', 'integration'] },
    { keywords: ['conflict', 'communication', 'feedback'], module: ['communication', 'triggers', 'conflict'] },
    { keywords: ['leadership', 'team', 'decision', 'delegate'], module: ['leadership', 'delegation', 'decision'] },
    { keywords: ['growth', 'develop', 'habit'], module: ['growth', 'line', 'integration'] }
  ];

  boostPairs.forEach(pair => {
    const queryMatch = pair.keywords.some(key => lowerQuery.includes(key));
    const moduleMatch = pair.module.some(key => module.text.toLowerCase().includes(key) || module.title.toLowerCase().includes(key));
    if (queryMatch && moduleMatch) score += 3;
  });

  return score;
}

function classifyFocusError(error) {
  if (!error) return 'unknown';
  if (typeof error.status === 'number') return `http_${error.status}`;
  const message = String(error.message || error).toLowerCase();
  if (message.includes('aborted') || message.includes('timeout')) return 'timeout';
  if (message.includes('stream disconnected before completion')) return 'stream_disconnected';
  if (message.includes('failed to fetch') || message.includes('network')) return 'network';
  return 'unknown';
}

function isTransientFocusError(error) {
  const status = Number(error && error.status);
  if ([408, 409, 429].includes(status)) return true;
  if (status >= 500 && status < 600) return true;
  const message = String(error && error.message ? error.message : error).toLowerCase();
  return (
    message.includes('stream disconnected before completion') ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('aborted')
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function requestFocusRerankFromAI(promptText, candidates) {
  const url = FOCUS_AI_API_ROUTE;
  const attempts = 5;
  const backoffMs = [500, 1000, 2000, 4000, 8000];
  const shortCandidates = candidates.map(item => ({
    id: item.id,
    sectionLabel: item.sectionLabel,
    title: item.title,
    excerpt: item.text.slice(0, 600)
  }));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            promptText,
            candidates: shortCandidates
          })
        },
        60 * 1000
      );

      if (!response.ok) {
        const errorBody = await response.text();
        const error = new Error(`Focus AI route error ${response.status}: ${errorBody.slice(0, 240)}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const rankedIds = Array.isArray(data.rankedIds) ? data.rankedIds : [];
      const rationales = data.rationales && typeof data.rationales === 'object' ? data.rationales : {};
      return { rankedIds, rationales };
    } catch (error) {
      const errorClass = classifyFocusError(error);
      const transient = isTransientFocusError(error);
      const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)];
      const jitterFactor = 1 + ((Math.random() * 0.4) - 0.2);
      const jitteredDelay = Math.max(50, Math.round(delay * jitterFactor));

      console.log('[focus][ai] retry decision', {
        attempt,
        maxAttempts: attempts,
        transient,
        errorClass,
        delayMs: transient && attempt < attempts ? jitteredDelay : 0
      });

      if (!transient || attempt >= attempts) {
        throw error;
      }

      await sleep(jitteredDelay);
    }
  }

  return { rankedIds: [], rationales: {} };
}

async function rankFocusModules(promptText, queryTokens) {
  const keywordRanked = REPORT_MODULES
    .map(module => ({ ...module, score: scoreModule(module, promptText, queryTokens) }))
    .sort((a, b) => b.score - a.score)
    .filter(module => module.score > 0);

  if (!keywordRanked.length) {
    return { results: [], aiUsed: false };
  }

  const candidatePool = keywordRanked.slice(0, 12);
  if (!FOCUS_AI_ENABLED) {
    return { results: candidatePool.slice(0, 6), aiUsed: false };
  }

  const aiResponse = await requestFocusRerankFromAI(promptText, candidatePool);
  const candidateMap = new Map(candidatePool.map(item => [item.id, item]));
  const reranked = [];

  aiResponse.rankedIds.forEach(id => {
    if (!candidateMap.has(id)) return;
    const module = candidateMap.get(id);
    reranked.push({
      ...module,
      aiReason: typeof aiResponse.rationales[id] === 'string' ? aiResponse.rationales[id] : ''
    });
  });

  if (!reranked.length) {
    return { results: candidatePool.slice(0, 6), aiUsed: false };
  }

  return { results: reranked.slice(0, 6), aiUsed: true };
}

function renderFocusResults(results, queryText) {
  const focusResults = document.getElementById('focusResults');
  if (!focusResults) return;

  if (!queryText.trim()) {
    focusResults.innerHTML = '';
    return;
  }

  if (!results.length) {
    focusResults.innerHTML = '';
    return;
  }

  focusResults.innerHTML = '';

  results.forEach(result => {
    const item = document.createElement('article');
    item.className = 'focus-result-item';
    const clonedCard = cloneCardForFocus(result.element);
    const titleNode = clonedCard.querySelector('.ct');

    const jumpButton = document.createElement('button');
    jumpButton.className = 'focus-jump';
    jumpButton.type = 'button';
    jumpButton.textContent = 'Full Section';
    jumpButton.setAttribute('data-testid', `focus-jump-${result.id}`);
    jumpButton.setAttribute('aria-label', `Go to ${result.sectionLabel}`);
    jumpButton.title = `${result.sectionLabel}`;
    jumpButton.addEventListener('click', () => {
      console.log('[focus] jump to source', { sectionId: result.sectionId, moduleId: result.id, title: result.title });
      showSec(result.sectionId);
      window.requestAnimationFrame(() => {
        if (result.element) {
          result.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    if (titleNode) {
      const titleGroup = document.createElement('span');
      titleGroup.className = 'focus-card-title';

      while (titleNode.firstChild) {
        titleGroup.appendChild(titleNode.firstChild);
      }

      titleNode.appendChild(titleGroup);
      titleNode.appendChild(jumpButton);
    } else {
      clonedCard.prepend(jumpButton);
    }

    item.appendChild(clonedCard);
    focusResults.appendChild(item);
  });
}

function jumpToReportModule(module) {
  if (!module || !module.element) return;
  console.log('[search] jump request', { id: module.id, sectionId: module.sectionId, title: module.title });
  showSec(module.sectionId);
  toggleSearchPopout(false);
  setTimeout(() => {
    if (!module.element) return;
    if (!module.element.isConnected) {
      console.log('[search] jump target disconnected from DOM', { id: module.id });
      return;
    }
    module.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    module.element.classList.add('search-hit');
    setTimeout(() => module.element && module.element.classList.remove('search-hit'), 1800);
  }, 120);
}

function renderSearchEverywhereResults(results) {
  const root = document.getElementById('searchEverywhereResults');
  if (!root) return;
  root.innerHTML = '';
  results.forEach(result => {
    const row = document.createElement('div');
    row.className = 'search-result';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Open ${result.title} in ${result.sectionLabel}`);
    const onOpenResult = () => jumpToReportModule(result);
    row.addEventListener('click', onOpenResult);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpenResult();
      }
    });
    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = result.title;
    const meta = document.createElement('div');
    meta.className = 'search-result-meta';
    meta.textContent = `${result.sectionLabel}`;
    left.appendChild(title);
    left.appendChild(meta);
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'search-jump';
    jump.textContent = 'Open';
    jump.addEventListener('click', (event) => {
      event.stopPropagation();
      onOpenResult();
    });
    row.appendChild(left);
    row.appendChild(jump);
    root.appendChild(row);
  });
}

function runSearchEverywhere() {
  const input = document.getElementById('searchEverywhereInput');
  const status = document.getElementById('searchEverywhereStatus');
  const root = document.getElementById('searchEverywhereResults');
  const query = String(input?.value || '').trim();
  if (!REPORT_MODULES.length) buildReportModuleIndex();
  if (!query) {
    if (status) status.textContent = 'Enter a keyword or phrase to find relevant sections.';
    if (root) root.innerHTML = '';
    return;
  }
  const queryTokens = tokenize(query);
  const ranked = REPORT_MODULES
    .map(module => {
      let score = scoreModule(module, query, queryTokens);
      const queryLower = query.toLowerCase();
      const titleLower = module.title.toLowerCase();
      const textLower = module.text.toLowerCase();
      if (titleLower.includes(queryLower)) score += 14;
      if (textLower.includes(queryLower)) score += 8;
      return { ...module, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter(module => module.score > 0)
    .slice(0, 8);
  if (!ranked.length) {
    if (status) status.textContent = 'No matches found. Try another phrase.';
    if (root) root.innerHTML = '';
    return;
  }
  if (status) status.textContent = `Found ${ranked.length} matches. Click OPEN on a result to jump there.`;
  renderSearchEverywhereResults(ranked);
  console.log('[search] query resolved', { query, matches: ranked.length, top: ranked[0].id });
}

async function runFocusFilter() {
  const promptText = document.getElementById('focusPromptText')?.value || '';
  const status = document.getElementById('focusStatus');
  const submitButton = document.getElementById('focusSubmit');
  const requestId = ++focusRequestCounter;

  const combined = promptText;
  const queryTokens = tokenize(combined);

  if (!combined.trim()) {
    if (status) status.textContent = 'Add at least one response to filter relevant modules.';
    renderFocusResults([], '');
    showSec('focus');
    return;
  }

  if (!REPORT_MODULES.length) buildReportModuleIndex();
  if (submitButton) submitButton.disabled = true;

  if (status) {
    status.textContent = FOCUS_AI_ENABLED
      ? 'Analyzing your prompt and ranking with AI...'
      : 'AI not configured. Using keyword ranking...';
  }

  try {
    const ranked = await rankFocusModules(combined, queryTokens);
    if (requestId !== focusRequestCounter) return;

    console.log('[focus] run filter', {
      queryLength: combined.length,
      tokenCount: queryTokens.length,
      matched: ranked.results.length,
      aiUsed: ranked.aiUsed
    });

    if (status) {
      if (!ranked.results.length) {
        status.textContent = 'No strong matches. Try adding more specifics.';
      } else if (ranked.aiUsed) {
        status.textContent = `Found ${ranked.results.length} relevant modules (AI ranked).`;
      } else {
        status.textContent = `Found ${ranked.results.length} relevant modules.`;
      }
    }

    renderFocusResults(ranked.results, combined);
    showSec('focus');
  } catch (error) {
    const errorClass = classifyFocusError(error);
    console.log('[focus][ai] ranking failed, falling back to keyword ranking', { errorClass, error });
    const fallback = REPORT_MODULES
      .map(module => ({ ...module, score: scoreModule(module, combined, queryTokens) }))
      .sort((a, b) => b.score - a.score)
      .filter(module => module.score > 0)
      .slice(0, 6);
    if (status) {
      status.textContent = fallback.length
        ? `Found ${fallback.length} relevant modules (AI error: ${errorClass}; fallback used).`
        : 'No strong matches. Try adding more specifics.';
    }
    renderFocusResults(fallback, combined);
    showSec('focus');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function resetFocusPrompt() {
  focusRequestCounter += 1;
  ['focusPromptText'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const status = document.getElementById('focusStatus');
  if (status) status.textContent = 'Uses your report content to surface the most relevant modules.';
  renderFocusResults([], '');
  console.log('[focus] prompt reset');
}

let refCat = 'leadership';
const refCatLabels = {leadership:'Leadership',relationships:'Relationships',regulation:'Self-Regulation',growth:'Growth',wellbeing:'Wellbeing'};

function currentCoreTypeLabel() {
  return `Type ${REPORT.typeNumber} — ${REPORT.typeName}`;
}

function getLineTypeNumber(line) {
  const raw = String(line || "").trim();
  const explicit = raw.match(/Type\s*([1-9])/i);
  if (explicit) return explicit[1];
  const bare = raw.match(/\b([1-9])\b/);
  return bare ? bare[1] : '';
}

function formatTypeLine(line) {
  const typeNumber = getLineTypeNumber(line);
  return typeNumber ? `Type ${typeNumber}` : line;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value;
}

function setHtml(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  node.innerHTML = value;
}

function formatScoreObject(labelMap, scores) {
  if (!scores || typeof scores !== 'object') return "Not detected";
  const entries = Object.entries(scores)
    .map(([key, value]) => [key, toFiniteScoreOrNull(value)])
    .filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => `${labelMap[key] || key}: ${Number(value)}`);
  return entries.length ? entries.join(" · ") : "Not detected";
}

function formatOptionalText(value, fallback = "Not detected") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

const INTEGRATION_LEVELS = ["Very Low", "Low", "Moderate", "High", "Very High"];
const INTEGRATION_LEVEL_SIGNALS = {
  "Very Low": [
    { tone: "neg", text: "Reactivity is likely to feel intense and hard to regulate right now." },
    { tone: "neg", text: "Criticism may land as threat and trigger defensive or forceful responses." },
    { tone: "neg", text: "Rest, grounding, and support are essential before pushing through major pressure." },
  ],
  "Low": [
    { tone: "neg", text: "Reactive and aggressive behaviours are more likely to show up frequently." },
    { tone: "neg", text: "You may be especially sensitive to criticism from people you protect." },
    { tone: "neg", text: "Controlling explosive anger may be difficult when you feel vulnerable or controlled." },
  ],
  "Moderate": [
    { tone: "neu", text: "You can usually regulate pressure, though stress may still narrow your flexibility." },
    { tone: "neu", text: "Pausing before action helps convert intensity into clearer leadership choices." },
    { tone: "pos", text: "With deliberate reflection, you can recover quickly and reset your tone." },
  ],
  "High": [
    { tone: "pos", text: "You are generally steady, responsive, and less reactive under strain." },
    { tone: "pos", text: "You can channel power with restraint while staying connected to others." },
    { tone: "pos", text: "Setbacks are more likely to become learning moments than conflict spirals." },
  ],
  "Very High": [
    { tone: "pos", text: "You demonstrate strong self-mastery, emotional range, and grounded influence." },
    { tone: "pos", text: "Even under pressure, you can stay open, collaborative, and strategically clear." },
    { tone: "pos", text: "Your presence tends to stabilize groups and elevate collective performance." },
  ],
};

function normalizeIntegrationLevel(levelRaw) {
  const normalized = String(levelRaw == null ? "" : levelRaw)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (!normalized) return "Low";
  if (/very\s*low/.test(normalized)) return "Very Low";
  if (/\blow\b/.test(normalized)) return "Low";
  if (/very\s*high/.test(normalized)) return "Very High";
  if (/\bhigh\b/.test(normalized)) return "High";
  if (/\bmoderate\b|\bmedium\b/.test(normalized)) return "Moderate";
  return "Low";
}

function getIntegrationLevelIndex(levelRaw) {
  const normalized = normalizeIntegrationLevel(levelRaw);
  const index = INTEGRATION_LEVELS.indexOf(normalized);
  return index >= 0 ? index : 1;
}

function getIntegrationLevelNarrative(level) {
  return `You are operating at a ${String(level || "Low").toLowerCase()} level of Enneagram awareness and mastery in this report.`;
}

function setBarRow(barId, valueId, value, options = {}) {
  const barNode = document.getElementById(barId);
  const valueNode = document.getElementById(valueId);
  const numeric = toFiniteScoreOrNull(value);
  const hasValue = Number.isFinite(numeric);
  const safeValue = hasValue ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
  if (barNode) barNode.style.width = `${safeValue}%`;
  if (valueNode) {
    const label = hasValue
      ? (typeof options.valueFormatter === "function" ? options.valueFormatter(safeValue) : String(safeValue))
      : (options.nullLabel || "N/A");
    valueNode.textContent = String(label);
  }
  if (valueNode && options.color) valueNode.style.color = options.color;
}

function setCenterLevelChip(chipId, value) {
  const chipNode = document.getElementById(chipId);
  if (!chipNode) return;
  const numeric = toFiniteScoreOrNull(value);
  const hasValue = Number.isFinite(numeric);
  const safeValue = hasValue ? Math.max(0, Math.min(100, Math.round(numeric))) : null;
  const level = hasValue ? scoreBandLabel(safeValue) : "N/A";
  chipNode.textContent = level;
  chipNode.classList.remove('center-chip-high', 'center-chip-medium', 'center-chip-low');
  if (level === "High") chipNode.classList.add('center-chip-high');
  else if (level === "Medium") chipNode.classList.add('center-chip-medium');
  else chipNode.classList.add('center-chip-low');
}

const CENTER_EXPRESSION_ORDER = [
  { key: 'body', label: 'Action Center' },
  { key: 'heart', label: 'Feeling Center' },
  { key: 'head', label: 'Thinking Center' },
];
const CENTER_LEVEL_SORT_RANK = { High: 0, Medium: 1, Low: 2, "N/A": 3 };

function getCenterLevelSortRank(level) {
  return CENTER_LEVEL_SORT_RANK[level] ?? CENTER_LEVEL_SORT_RANK["N/A"];
}

function buildSortedCenterExpressionRows(centerScoresRaw) {
  const centerScores = centerScoresRaw && typeof centerScoresRaw === "object" ? centerScoresRaw : {};
  return CENTER_EXPRESSION_ORDER.map((item, fallbackIndex) => {
    const candidate = toFiniteScoreOrNull(centerScores?.[item.key]);
    const hasValue = Number.isFinite(candidate);
    const score = hasValue ? Math.max(0, Math.min(100, Math.round(candidate))) : null;
    const level = hasValue ? scoreBandLabel(score) : "N/A";
    return { ...item, fallbackIndex, score, level };
  }).sort((a, b) => {
    const levelOrder = getCenterLevelSortRank(a.level) - getCenterLevelSortRank(b.level);
    if (levelOrder !== 0) return levelOrder;
    if (Number.isFinite(a.score) && Number.isFinite(b.score)) {
      return b.score - a.score || a.fallbackIndex - b.fallbackIndex;
    }
    if (Number.isFinite(a.score)) return -1;
    if (Number.isFinite(b.score)) return 1;
    return a.fallbackIndex - b.fallbackIndex;
  });
}

function sortCenterExpressionRows(centerScoresRaw) {
  const orderedRows = buildSortedCenterExpressionRows(centerScoresRaw);
  console.log('[centers] sorted expression rows high-to-low', orderedRows.map((row) => ({
    key: row.key,
    label: row.label,
    level: row.level,
    score: row.score,
  })));

  const rowsContainer = document.getElementById('centerExpressionRows');
  if (rowsContainer) {
    orderedRows.forEach((row) => {
      const rowNode = rowsContainer.querySelector(`[data-center-row="${row.key}"]`);
      if (rowNode) rowsContainer.appendChild(rowNode);
    });
  }

  const narrativesContainer = document.getElementById('centerExpressionNarratives');
  if (narrativesContainer) {
    orderedRows.forEach((row) => {
      const rowNode = narrativesContainer.querySelector(`[data-center-row="${row.key}"]`);
      if (rowNode) narrativesContainer.appendChild(rowNode);
    });
  }
}

const STRAIN_BREAKDOWN_ORDER = [
  { key: 'happiness', label: 'Happiness', fallbackIndex: 0, barColor: 'var(--red)', valueColor: 'var(--red)' },
  { key: 'vocational', label: 'Vocational', fallbackIndex: 1, barColor: 'var(--gold)' },
  { key: 'interpersonal', label: 'Interpersonal', fallbackIndex: 2, barColor: 'var(--gold)' },
  { key: 'physical', label: 'Physical', fallbackIndex: 3, barColor: 'var(--gold)' },
  { key: 'environmental', label: 'Environmental', fallbackIndex: 4, barColor: 'var(--green)' },
  { key: 'psychological', label: 'Psychological', fallbackIndex: 5, barColor: 'var(--green)' },
];
const STRAIN_LEVEL_SORT_RANK = { High: 0, Medium: 1, Low: 2, "N/A": 3 };

function getStrainLevelSortRank(level) {
  return STRAIN_LEVEL_SORT_RANK[level] ?? STRAIN_LEVEL_SORT_RANK["N/A"];
}

function isHappinessStrainCategory(category) {
  const normalized = String(category == null ? "" : category).trim().toLowerCase();
  return normalized === "happiness" || normalized === "happiness strain";
}

function getStrainChipClass(level, category) {
  const normalizedLevel = String(level == null ? "" : level).trim().toUpperCase();
  const isHappiness = isHappinessStrainCategory(category);
  if (isHappiness) {
    if (normalizedLevel === "HIGH") return "strain-chip-low";
    if (normalizedLevel === "MEDIUM") return "strain-chip-medium";
    if (normalizedLevel === "LOW") return "strain-chip-high";
    return "cx";
  }
  if (normalizedLevel === "HIGH") return "strain-chip-high";
  if (normalizedLevel === "MEDIUM") return "strain-chip-medium";
  if (normalizedLevel === "LOW") return "strain-chip-low";
  return "cx";
}

function renderStrainBreakdownRows(strainScoresRaw, fallbackStrainScores) {
  const container = document.getElementById('strainBreakdownRows');
  if (!container) return;

  const rows = STRAIN_BREAKDOWN_ORDER.map((item) => {
    const candidate = toFiniteScoreOrNull(strainScoresRaw?.[item.key] ?? fallbackStrainScores?.[item.fallbackIndex]);
    const hasValue = Number.isFinite(candidate);
    const score = hasValue ? Math.max(0, Math.min(100, Math.round(candidate))) : null;
    const band = hasValue ? scoreBandLabel(score) : "N/A";
    return { ...item, hasValue, score, band };
  }).sort((a, b) => {
    const bandOrder = getStrainLevelSortRank(a.band) - getStrainLevelSortRank(b.band);
    if (bandOrder !== 0) return bandOrder;
    if (a.hasValue && b.hasValue) return b.score - a.score || a.fallbackIndex - b.fallbackIndex;
    if (a.hasValue) return -1;
    if (b.hasValue) return 1;
    return a.fallbackIndex - b.fallbackIndex;
  });

  console.log('[strain] sorted breakdown rows high-to-low', rows.map((row) => ({
    key: row.key,
    label: row.label,
    score: row.score,
    band: row.band,
  })));

  container.innerHTML = rows.map((row) => {
    const valueLabel = row.band;
    const chipClass = getStrainChipClass(valueLabel, row.label);
    return `<div class="brow"><div class="blbl">${row.label}</div><span class="chip ${chipClass}">${valueLabel}</span></div>`;
  }).join("");
}

function syncStrainOverviewCardHeight() {
  const breakdownCard = document.getElementById('strainBreakdownCard');
  const overallCard = document.querySelector('#strainWriteupCards .card');
  if (!breakdownCard || !overallCard) return;
  const targetHeight = Math.max(0, Math.round(overallCard.getBoundingClientRect().height));
  if (!targetHeight) return;
  breakdownCard.style.height = `${targetHeight}px`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildAdaptiveListHtml(items) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) return "";
  return rows
    .map((row) => {
      const tone = String(row?.tone || "neu");
      const symbol = String(row?.symbol || (tone === "neg" ? "!" : tone === "pos" ? "✓" : "•"));
      const text = ensureSentenceStartsCapitalized(formatOptionalText(row?.text, ""));
      if (!text) return "";
      return `<div class="ti"><div class="tic ${tone}">${escapeHtml(symbol)}</div><div class="tt">${escapeHtml(text)}</div></div>`;
    })
    .filter(Boolean)
    .join("");
}

function buildAdaptiveBulletListHtml(items) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) return "";
  return rows
    .map((item) => ensureSentenceStartsCapitalized(formatOptionalText(item, "")))
    .filter(Boolean)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function buildAdaptiveTriggerGridHtml(items) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) return "";
  return rows
    .map((item) => {
      const title = formatOptionalText(item?.title, "");
      const desc = formatOptionalText(item?.desc, "");
      if (!title && !desc) return "";
      return `<div class="tg-item"><div class="tg-title">${escapeHtml(title || "Trigger")}</div><div class="tg-desc">${escapeHtml(desc || "Not detected in assigned PDF.")}</div></div>`;
    })
    .filter(Boolean)
    .join("");
}

function ensureSentencePunctuation(text) {
  const value = cleanPdfExtractedValue(text || "");
  if (!value) return "";
  return /[.?!]$/.test(value) ? value : `${value}.`;
}

function summarizeSentence(text, maxWords = 18) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length <= maxWords) return ensureSentencePunctuation(words.join(" "));
  return `${ensureSentencePunctuation(words.slice(0, maxWords).join(" ")).replace(/[.?!]$/, "...")}`;
}

function extractFeedbackGuidancePoints(text, maxItems = 6) {
  const normalized = normalizeExtractedText(text || "");
  if (!normalized) return [];

  const symbolRows = extractBulletItemsFromText(normalized, maxItems);
  if (symbolRows.length) {
    return symbolRows.map((row) => ensureSentencePunctuation(row)).filter(Boolean);
  }

  const cueSplitPattern =
    /\s+(?=(?:Start|Keep|Be|Ask|Focus|Avoid|Reinforce|Position|Create|Allow|Answer|Use|Express|Give|Openly|State|Listen|Invite|Minimise|Don't|Do\s+not|Get|Try|Watch|When|If)\b)/g;
  const cueRows = normalized
    .split(cueSplitPattern)
    .map((row) => ensureSentencePunctuation(row))
    .filter(Boolean)
    .filter((row) => row.length >= 16);
  if (cueRows.length) {
    return Array.from(new Set(cueRows)).slice(0, maxItems);
  }

  const sentenceRows = normalized
    .split(/(?<=[.?!])\s+/)
    .map((row) => ensureSentencePunctuation(row))
    .filter(Boolean)
    .filter((row) => row.length >= 16);
  if (sentenceRows.length) {
    return Array.from(new Set(sentenceRows)).slice(0, maxItems);
  }

  const fallback = ensureSentencePunctuation(normalized);
  return fallback ? [fallback] : [];
}

function renderFeedbackGuidanceCell(text) {
  const points = extractFeedbackGuidancePoints(text, 6);
  if (!points.length) return escapeHtml("Not detected in assigned PDF.");
  const summary = summarizeSentence(points[0], 16);
  const bullets = buildAdaptiveListHtml(
    points.map((point) => ({ tone: "neu", symbol: "•", text: point })),
  );
  return `<div style="margin-bottom:6px;font-size:12px;color:var(--text3)"><strong>Summary:</strong> ${escapeHtml(summary)}</div>${bullets}`;
}

function buildAdaptiveSectionCopy(report) {
  const typeNumber = String(report?.typeNumber || "?");
  const typeName = formatOptionalText(report?.typeName, "Profile");
  const typeLabel = `Type ${typeNumber}`;
  const instinct = formatOptionalText(report?.instinct, "Not detected");
  const instinctCode = String(instinct).split("—")[0].trim() || instinct;
  const keyword = formatOptionalText(report?.keyword, "core pattern");
  const giftsDesc = formatOptionalText(report?.giftsDesc || report?.gifts, "You bring consistent strengths when pressure rises.");
  const viceDesc = formatOptionalText(report?.viceDesc || report?.vice, "Pressure can narrow flexibility if left unchecked.");
  const worldview = formatOptionalText(report?.worldview, "clear priorities and practical outcomes");
  const focus = formatOptionalText(report?.focus, "what matters most in the moment");
  const conflictStyle = formatOptionalText(report?.conflictStyle, "Responsive");
  const thinkingStyle = String(formatOptionalText(report?.thinkingStyle, "Balanced")).toLowerCase();
  const traits = Array.isArray(report?.traits) ? report.traits.filter(Boolean).slice(0, 4) : [];
  while (traits.length < 4) {
    traits.push(traits.length === 0 ? "Clarity under pressure" : traits.length === 1 ? "Commitment to outcomes" : traits.length === 2 ? "Strategic perspective" : "Reliable follow-through");
  }

  return {
    strengths: [
      { tone: "pos", symbol: "+", text: giftsDesc },
      { tone: "pos", symbol: "+", text: `${typeLabel} tends to contribute ${traits[0].toLowerCase()} and ${traits[1].toLowerCase()}.` },
      { tone: "pos", symbol: "+", text: `Your ${instinctCode} instinct often supports trust-building through direct engagement.` },
      { tone: "pos", symbol: "+", text: `Your focus on ${focus.toLowerCase()} can create momentum when direction is clear.` },
    ],
    challenges: [
      { tone: "neg", symbol: "!", text: viceDesc },
      { tone: "neg", symbol: "!", text: `When pace is high, ${typeLabel} can over-index on ${keyword.toLowerCase()} and under-signal empathy.` },
      { tone: "neg", symbol: "!", text: "Decisions made too quickly can reduce buy-in from key stakeholders." },
      { tone: "neg", symbol: "!", text: "Recovery and reflection are required to avoid reactive loops." },
    ],
    blindSpotsLeft: [
      { tone: "neg", symbol: "!", text: "Your intent and your impact may diverge under pressure." },
      { tone: "neg", symbol: "!", text: `A ${thinkingStyle} thinking style can be read as distance when teammates need reassurance.` },
    ],
    blindSpotsRight: [
      { tone: "neg", symbol: "!", text: `${conflictStyle} conflict responses may feel abrupt to slower-paced collaborators.` },
      { tone: "neg", symbol: "!", text: "Naming assumptions out loud reduces misalignment and rework." },
    ],
    triggers: [
      { title: "Loss of Clarity", desc: `Ambiguous priorities conflict with your worldview: ${worldview}` },
      { title: "Slow Follow-Through", desc: "Unclear ownership or missed commitments can quickly elevate strain." },
      { title: "Mixed Signals", desc: "Inconsistent communication can feel unsafe and inefficient." },
      { title: "Decision Gridlock", desc: "Extended indecision often creates avoidable friction." },
      { title: "Misaligned Expectations", desc: "When standards are implicit, trust and execution can drop." },
    ],
    leadershipIntroHtml: `<strong>Your ${typeLabel} (${typeName}) style often leads through ${keyword.toLowerCase()} and visible ownership.</strong> The growth edge is balancing speed with shared alignment and steady collaboration.`,
    goalSummary: `Goal setting works best when priorities connect to ${focus.toLowerCase()} and measurable outcomes.`,
    goalList: [
      { tone: "pos", symbol: "✓", text: "Anchor goals to clear outcomes and ownership." },
      { tone: "pos", symbol: "✓", text: "Set explicit check-points for progress and risk review." },
      { tone: "neg", symbol: "!", text: "Reconfirm buy-in before moving from decision to execution." },
    ],
    planningSummary: "Planning is most effective when it preserves momentum and reduces ambiguity.",
    planningDetail: "Use shorter planning cycles, clear dependencies, and visible decision checkpoints to keep execution aligned.",
    delegationCopy: "Delegation improves when scope, authority boundaries, and follow-up cadence are explicit from the start.",
    decisionList: [
      { tone: "pos", symbol: "✓", text: "State the decision, rationale, and success criteria clearly." },
      { tone: "neg", symbol: "!", text: "Invite dissent early to surface blind spots before commitment." },
      { tone: "neu", symbol: "→", text: "Revisit assumptions quickly when data changes." },
    ],
    communicationPattern: [
      `Communication style tends to reflect ${keyword.toLowerCase()} priorities.`,
      "Preference for concise, actionable language.",
      `A ${thinkingStyle} approach can emphasize efficiency over emotional context.`,
      "Directness often increases under stress.",
      "Clear role expectations improve collaboration quality.",
      "Explicit empathy cues improve message reception.",
    ],
    communicationVerbal: [
      { tone: "pos", symbol: "→", text: "You are often clear, focused, and outcome-oriented in meetings." },
      { tone: "pos", symbol: "→", text: "You usually communicate priorities and constraints quickly." },
      { tone: "neg", symbol: "!", text: "Compressed delivery can sound harsher than intended." },
      { tone: "neg", symbol: "!", text: "Pausing to check understanding reduces downstream conflict." },
    ],
    communicationListening: [
      { tone: "pos", symbol: "✓", text: "Listening improves when goals and context are explicit." },
      { tone: "neg", symbol: "!", text: "Stress can narrow curiosity and shorten patience." },
      { tone: "neg", symbol: "!", text: "Reflecting back what you heard helps others feel understood." },
    ],
    communicationFeedback: [
      { tone: "neg", symbol: "!", text: "Lead with intent and impact before corrective points." },
      { tone: "neg", symbol: "!", text: "Match intensity to the relationship and context." },
      { tone: "pos", symbol: "→", text: "Pair direct feedback with one concrete support action." },
    ],
    teamStages: {
      forming: `In Forming, ${typeLabel} often establishes direction quickly by clarifying standards, role ownership, and early momentum.`,
      storming: `In Storming, your ${keyword.toLowerCase()} style can surface conflict fast; naming intent and inviting dissent keeps tension productive.`,
      norming: `In Norming, trust grows when you translate ${focus.toLowerCase()} into shared rituals, clear handoffs, and explicit accountability.`,
      performing: `In Performing, your strengths compound when pace stays high but collaboration remains visible through delegated authority and feedback loops.`,
    },
  };
}

function buildDevExercisePathHtml(paths) {
  const safePaths = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (!safePaths.length) return "";
  return safePaths
    .map((path, index) => {
      const title = formatOptionalText(path?.title, `Growth Path ${index + 1}`);
      const text = ensureSentenceStartsCapitalized(sanitizeSnippet(formatOptionalText(path?.text, "Not detected in assigned PDF."), "Not detected in assigned PDF."));
      const source = sanitizeSnippet(formatOptionalText(path?.source, ""), "");
      const showSource = Boolean(source) && !/extracted\s+from\s+assigned\s+pdf/i.test(source);
      return `<div class="dev-item"><div class="dev-item-title">${escapeHtml(title)}</div><p>${escapeHtml(text)}</p>${showSource ? `<div class="subh" style="margin:8px 0 0">${escapeHtml(source)}</div>` : ""}</div>`;
    })
    .join("");
}

function buildDevExerciseComponentData(report) {
  const typeLabel = `Type ${String(report?.typeNumber || "?")}`;
  const integrationLevel = normalizeIntegrationLevel(report?.integration);
  const overallStrainDirect = toFiniteScoreOrNull(report?.strainScoresRaw?.overall);
  const fallbackStrainValues = Array.isArray(report?.strain)
    ? report.strain.map((value) => toFiniteScoreOrNull(value)).filter((value) => Number.isFinite(value))
    : [];
  const overallStrainScore = Number.isFinite(overallStrainDirect)
    ? overallStrainDirect
    : (fallbackStrainValues.length
        ? Math.round(fallbackStrainValues.reduce((acc, value) => acc + Number(value || 0), 0) / fallbackStrainValues.length)
        : null);
  const overallStrainLevel = Number.isFinite(overallStrainScore) ? scoreBandLabel(overallStrainScore) : "Medium";

  const integrationPriority = {
    "Very Low": "Start with regulation and short daily reset rituals before pushing performance targets.",
    Low: "Build steadier self-observation so reactivity does not drive decisions under pressure.",
    Moderate: "Strengthen consistency by linking insight to repeatable weekly behavioral commitments.",
    High: "Maintain growth by scaling reflective practices into team-level habits and mentoring.",
    "Very High": "Consolidate mastery through service, teaching, and deliberate recovery cycles.",
  };
  const strainPriority = {
    High: "Protect recovery windows, lower cognitive load, and de-escalate commitments that are not essential.",
    Medium: "Use rhythm-based recovery and one deliberate check-in each day to prevent stress buildup.",
    Low: "Preserve energy gains with light maintenance habits and intentional long-range planning.",
  };

  const extractedExercises = Array.isArray(report?.developmentExercises) ? report.developmentExercises : [];
  const extractedPaths = extractedExercises
    .map((entry, index) => {
      const title = formatOptionalText(entry?.title, `Exercise ${index + 1}`);
      const text = formatOptionalText(entry?.text || entry, "");
      if (!text || isMissingExtractedText(text)) return null;
      return {
        title,
        text: ensureSentenceStartsCapitalized(sanitizeSnippet(text, text)),
        source: "",
      };
    })
    .filter(Boolean);

  const generatedPaths = [
    {
      title: "Integration Stabilizer",
      text: integrationPriority[integrationLevel] || integrationPriority.Moderate,
      source: `Integration signal: ${integrationLevel.toUpperCase()}`,
    },
    {
      title: "Strain Regulator",
      text: strainPriority[overallStrainLevel] || strainPriority.Medium,
      source: `Overall strain signal: ${overallStrainLevel.toUpperCase()}${Number.isFinite(overallStrainScore) ? ` (${overallStrainScore})` : ""}`,
    },
    {
      title: "Applied Leadership Loop",
      text: "Close each week by naming one behavior to stop, one to continue, and one collaborative behavior to increase.",
      source: `${typeLabel} execution practice`,
    },
  ];

  const mergedPaths = [...extractedPaths, ...generatedPaths];
  const deduped = [];
  const seenTexts = new Set();
  for (const item of mergedPaths) {
    const key = normalizeExtractedText(item?.text || "").toLowerCase();
    if (!key || seenTexts.has(key)) continue;
    seenTexts.add(key);
    deduped.push(item);
    if (deduped.length >= 6) break;
  }

  const summary = `${typeLabel} growth path currently prioritizes ${integrationLevel.toUpperCase()} integration behaviors with ${overallStrainLevel.toUpperCase()} strain recovery tactics.`;
  console.log("[dev-exercise] built component data", {
    typeLabel,
    integrationLevel,
    overallStrainScore,
    overallStrainLevel,
    extractedExerciseCount: extractedPaths.length,
    renderedPathCount: deduped.length,
  });
  return {
    summary,
    paths: deduped,
  };
}

function buildSpreadsheetFocusFallbacks(report, adaptiveCopy = {}) {
  const centerLabel = formatOptionalText(report?.centreOfIntelligence, "current center");
  const integrationLevel = normalizeIntegrationLevel(report?.integration);
  const fallbackBodyLanguageRows = [
    "Posture and tone often intensify when urgency rises.",
    "Deliberate pacing and softer delivery improve receptivity.",
    "Visible self-regulation increases trust in high-stakes dialogue.",
  ];
  return {
    motivationSummary: firstPresentSnippet(
      [report?.motivation1, report?.motivation2],
      "Motivation details were not detected in the assigned PDF.",
    ),
    instinctGoals: {
      selfPres: "Self-Preservation focuses on security, practical stability, and resource stewardship.",
      social: "Social focuses on contribution, belonging, and role within the wider group.",
      oneOnOne: "One-on-One focuses on intensity, attraction, and depth in key relationships.",
    },
    developingAsCopy: firstPresentSnippet(
      [report?.motivation2, report?.giftsDesc],
      "Development guidance was not detected in the assigned PDF.",
    ),
    bodyLanguageRows: fallbackBodyLanguageRows,
    conflictResponseCopy: `Conflict response often reflects your ${formatOptionalText(report?.conflictStyle, "adaptive")} style under pressure.`,
    conflictTriggeredCopy: "When triggered, slowing the reaction cycle and naming impact improves outcomes.",
    centeredDecisionCopy: `Decisions often center through your ${centerLabel} perspective before balancing the other centers.`,
    decisionImpactCopy: `Your style can influence decisions through ${formatOptionalText(report?.focus, "focused pattern recognition")} and fast priority weighting.`,
    decisionStrainCopy: `At ${integrationLevel.toUpperCase()} integration, strain effects can amplify speed and certainty while reducing collaboration signals.`,
    strategicLeadershipCopy: formatOptionalText(
      adaptiveCopy?.leadershipIntroHtml
        ? String(adaptiveCopy.leadershipIntroHtml).replace(/<[^>]+>/g, " ")
        : "",
      "Strategic leadership guidance was not detected in the assigned PDF.",
    ),
    teamImpactCopy: "Team impact tends to be strongest when direction is clear, explicit, and tied to shared outcomes.",
    interdependenceCopy: "Interdependence improves when ownership is explicit, handoffs are visible, and feedback loops stay active.",
    coachingRelationshipCopy: "Coaching relationships strengthen through direct expectations, reflective listening, and paced challenge.",
  };
}

function renderBodyLanguageRows(rows) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  return buildAdaptiveListHtml(
    safeRows.map((text) => ({
      tone: "neu",
      symbol: "•",
      text: formatOptionalText(text, "Not detected in assigned PDF."),
    })),
  );
}

function extractTeamStageBulletItems(text, maxItems = 8) {
  const normalized = normalizeExtractedText(text || "");
  if (!normalized) return [];

  const fromSymbols = extractBulletItemsFromText(normalized, maxItems);
  if (fromSymbols.length) return fromSymbols;

  const cueSplitPattern =
    /\s+(?=(?:Make|Watch|Not|Assert|Forthright|Comfortably|Willing(?:ly)?|Reluctant|Demanding|Very|Be|Have|Miss|Try|Hold|Vacillate)\b)/g;
  const cueRows = normalized
    .split(cueSplitPattern)
    .map((row) => cleanPdfExtractedValue(row))
    .filter(Boolean)
    .filter((row) => row.length >= 18);
  if (cueRows.length) return Array.from(new Set(cueRows)).slice(0, maxItems);

  const sentenceRows = normalized
    .split(/(?<=[.?!])\s+/)
    .map((row) => cleanPdfExtractedValue(row))
    .filter(Boolean)
    .filter((row) => row.length >= 18);
  if (sentenceRows.length) return Array.from(new Set(sentenceRows)).slice(0, maxItems);

  const fallback = cleanPdfExtractedValue(normalized);
  return fallback ? [fallback] : [];
}

function renderTeamStageBullets(text) {
  const rows = extractTeamStageBulletItems(text, 8);
  if (!rows.length) {
    return buildAdaptiveListHtml([
      { tone: "neu", symbol: "•", text: "Not detected in assigned PDF." },
    ]);
  }
  return buildAdaptiveListHtml(
    rows.map((row) => ({
      tone: "neu",
      symbol: "•",
      text: row,
    })),
  );
}

function extractNarrativeBulletItems(text, maxItems = 8) {
  const normalized = normalizeExtractedText(text || "");
  if (!normalized) return [];

  const symbolRows = extractBulletItemsFromText(normalized, maxItems);
  if (symbolRows.length) return symbolRows;

  const cueSplitPattern =
    /\s+(?=(?:Quick|Able|Preference|Willingness|Your|You|At|Be|Consider|As|Make|Watch|Not|Forthright|Comfortably|Willing(?:ly)?|Reluctant|Demanding|Very|Have|Miss|Try|Hold|Vacillate)\b)/g;
  const cueRows = normalized
    .split(cueSplitPattern)
    .map((row) => cleanPdfExtractedValue(row))
    .filter(Boolean)
    .filter((row) => row.length >= 18);
  if (cueRows.length) return Array.from(new Set(cueRows)).slice(0, maxItems);

  const sentenceRows = normalized
    .split(/(?<=[.?!])\s+/)
    .map((row) => cleanPdfExtractedValue(row))
    .filter(Boolean)
    .filter((row) => row.length >= 18);
  if (sentenceRows.length) return Array.from(new Set(sentenceRows)).slice(0, maxItems);

  const fallback = cleanPdfExtractedValue(normalized);
  return fallback ? [fallback] : [];
}

function renderNarrativeBullets(text, options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const maxItems = Number.isFinite(Number(safeOptions.maxItems)) ? Number(safeOptions.maxItems) : 8;
  const fallbackText = formatOptionalText(safeOptions.fallbackText, "Not detected in assigned PDF.");
  const rows = extractNarrativeBulletItems(text, maxItems);
  if (!rows.length) {
    return buildAdaptiveListHtml([
      { tone: "neu", symbol: "•", text: fallbackText },
    ]);
  }
  return buildAdaptiveListHtml(
    rows.map((row) => ({
      tone: "neu",
      symbol: "•",
      text: row,
    })),
  );
}

function renderAdaptiveSectionCopy(report) {
  const copy = buildAdaptiveSectionCopy(report || {});
  setHtml('strengthsList', buildAdaptiveListHtml(copy.strengths));
  setHtml('challengesList', buildAdaptiveListHtml(copy.challenges));
  setHtml('blindSpotsLeftList', buildAdaptiveListHtml(copy.blindSpotsLeft));
  setHtml('blindSpotsRightList', buildAdaptiveListHtml(copy.blindSpotsRight));
  setHtml('triggersGrid', buildAdaptiveTriggerGridHtml(copy.triggers));

  setHtml('leadershipIntroCopy', copy.leadershipIntroHtml);
  setText('leadershipGoalSummary', copy.goalSummary);
  setHtml('leadershipGoalList', buildAdaptiveListHtml(copy.goalList));
  setText('leadershipPlanningSummary', copy.planningSummary);
  setText('leadershipPlanningDetail', copy.planningDetail);
  setText('leadershipDelegationCopy', copy.delegationCopy);
  setHtml('leadershipDecisionList', buildAdaptiveListHtml(copy.decisionList));

  setHtml('communicationPatternList', buildAdaptiveBulletListHtml(copy.communicationPattern));
  setHtml('communicationVerbalList', buildAdaptiveListHtml(copy.communicationVerbal));
  setHtml('communicationListeningList', buildAdaptiveListHtml(copy.communicationListening));
  setHtml('communicationFeedbackList', buildAdaptiveListHtml(copy.communicationFeedback));

  setHtml('teamStageForming', renderTeamStageBullets(formatOptionalText(copy.teamStages?.forming, "Not detected in assigned PDF.")));
  setHtml('teamStageStorming', renderTeamStageBullets(formatOptionalText(copy.teamStages?.storming, "Not detected in assigned PDF.")));
  setHtml('teamStageNorming', renderTeamStageBullets(formatOptionalText(copy.teamStages?.norming, "Not detected in assigned PDF.")));
  setHtml('teamStagePerforming', renderTeamStageBullets(formatOptionalText(copy.teamStages?.performing, "Not detected in assigned PDF.")));
  return copy;
}

function renderIntegrationPanel(levelRaw) {
  const normalizedLevel = normalizeIntegrationLevel(levelRaw);
  const activeIndex = getIntegrationLevelIndex(normalizedLevel);
  setText('integrationLevelHeading', normalizedLevel);
  setText('integrationLevelNarrative', getIntegrationLevelNarrative(normalizedLevel));

  const segmentsContainer = document.getElementById('integrationSegments');
  if (segmentsContainer) {
    const segments = Array.from(segmentsContainer.querySelectorAll('.int-seg'));
    segments.forEach((segment, index) => {
      segment.classList.toggle('act', index === activeIndex);
    });
  }

  const labelsContainer = document.getElementById('integrationLabels');
  if (labelsContainer) {
    const labels = Array.from(labelsContainer.querySelectorAll('span'));
    labels.forEach((labelNode, index) => {
      const label = INTEGRATION_LEVELS[index] || String(labelNode?.dataset?.level || "").trim() || "";
      labelNode.textContent = index === activeIndex ? `${label} \u25c0` : label;
      labelNode.classList.toggle('active', index === activeIndex);
    });
  }

  const signals = INTEGRATION_LEVEL_SIGNALS[normalizedLevel] || INTEGRATION_LEVEL_SIGNALS.Low;
  setHtml(
    'integrationSignals',
    signals
      .map(
        (signal) =>
          `<div class="ti"><div class="tic ${signal.tone}">!</div><div class="tt">${escapeHtml(signal.text)}</div></div>`,
      )
      .join(""),
  );
}

function formatStrainCardDetailContent(detail, item) {
  const normalizedDetail = formatOptionalText(detail, "Not detected in assigned PDF.");
  if (item.key === "overall") {
    return `<p style="font-size:13px;color:var(--text2)">${escapeHtml(normalizedDetail)}</p>`;
  }

  const rowItems = extractBulletItemsFromText(normalizedDetail, 6);
  if (!rowItems.length) {
    return `<p style="font-size:13px;color:var(--text2)">${escapeHtml(normalizedDetail)}</p>`;
  }

  const leadSentenceMatch = normalizedDetail.match(/^[^.?!]{8,220}[.?!]/);
  const introCandidate = cleanPdfExtractedValue(leadSentenceMatch?.[0] || "");
  const introText = /\bstrain\s+is\s+(?:LOW|MEDIUM|HIGH|MODERATE)\b/i.test(introCandidate) ? introCandidate : "";
  const dedupedRows = Array.from(
    new Set(
      rowItems
        .map((row) => cleanPdfExtractedValue(row || ""))
        .filter(Boolean),
    ),
  ).filter((row) => row.toLowerCase() !== introText.toLowerCase());

  if (!dedupedRows.length) {
    return `<p style="font-size:13px;color:var(--text2)">${escapeHtml(normalizedDetail)}</p>`;
  }

  const introHtml = introText
    ? `<p class="strain-detail-intro">${escapeHtml(introText)}</p>`
    : "";
  const rowsHtml = dedupedRows
    .map(
      (row) =>
        `<div class="ti"><div class="tic inf strain-detail-row-icon">•</div><div class="tt strain-detail-row-text">${escapeHtml(row)}</div></div>`,
    )
    .join("");
  return `${introHtml}<div class="tlist strain-detail-list">${rowsHtml}</div>`;
}

function getStrainCardVisual(level, category) {
  const normalizedLevel = String(level == null ? "" : level).trim().toUpperCase();
  if (normalizedLevel === "N/A") return { chipClass: "cx", chipLabel: "Not detected" };
  if (isHappinessStrainCategory(category)) {
    if (normalizedLevel === "HIGH") return { chipClass: "cgn", chipLabel: "Higher strain detected" };
    if (normalizedLevel === "MEDIUM") return { chipClass: "cg", chipLabel: "Moderate strain detected" };
    if (normalizedLevel === "LOW") return { chipClass: "cr", chipLabel: "Lower strain detected" };
    return { chipClass: "cr", chipLabel: "Lower strain detected" };
  }
  if (normalizedLevel === "HIGH") return { chipClass: "cr", chipLabel: "Higher strain detected" };
  if (normalizedLevel === "MEDIUM") return { chipClass: "cg", chipLabel: "Moderate strain detected" };
  if (normalizedLevel === "LOW") return { chipClass: "cgn", chipLabel: "Lower strain detected" };
  return { chipClass: "cgn", chipLabel: "Lower strain detected" };
}

function getStrainCardFallbackText(category, level) {
  return "Not detected in assigned PDF.";
}

function getStrainValueByKey(strainScoresRaw, fallbackStrainScores, key) {
  const orderLookup = {
    happiness: 0,
    vocational: 1,
    interpersonal: 2,
    physical: 3,
    environmental: 4,
    psychological: 5,
  };
  const raw = strainScoresRaw?.[key] ?? fallbackStrainScores?.[orderLookup[key]];
  const candidate = raw == null ? null : Number(raw);
  return Number.isFinite(candidate) ? Math.max(0, Math.min(100, Math.round(candidate))) : null;
}

function buildSortedStrainWriteupRows(strainScoresRaw, fallbackStrainScores, overallValue) {
  const normalizedOverall = overallValue == null ? null : Number(overallValue);
  const overallLevel = Number.isFinite(normalizedOverall) ? scoreBandLabel(normalizedOverall) : "N/A";
  const sortedAreaRows = STRAIN_BREAKDOWN_ORDER
    .map((item) => {
      const score = getStrainValueByKey(strainScoresRaw, fallbackStrainScores, item.key);
      return {
        title: item.label,
        key: item.key,
        score,
        level: Number.isFinite(score) ? scoreBandLabel(score) : "N/A",
        fallbackIndex: item.fallbackIndex,
      };
    })
    .sort((a, b) => {
      const bandOrder = getStrainLevelSortRank(a.level) - getStrainLevelSortRank(b.level);
      if (bandOrder !== 0) return bandOrder;
      if (Number.isFinite(a.score) && Number.isFinite(b.score)) {
        return b.score - a.score || a.fallbackIndex - b.fallbackIndex;
      }
      if (Number.isFinite(a.score)) return -1;
      if (Number.isFinite(b.score)) return 1;
      return a.fallbackIndex - b.fallbackIndex;
    });
  return [
    { title: "Overall Strain", key: "overall", score: normalizedOverall, level: overallLevel, fallbackIndex: -1 },
    ...sortedAreaRows,
  ];
}

function getStrainLevelFromKey(strainScoresRaw, fallbackStrainScores, key) {
  const value = getStrainValueByKey(strainScoresRaw, fallbackStrainScores, key);
  return Number.isFinite(value) ? scoreBandLabel(value) : "N/A";
}

function getStrainTicClass(level) {
  if (level === "High") return "neg";
  if (level === "Low") return "pos";
  return "neu";
}

function formatStrainNarrativeWithLevelChips(text, category) {
  const raw = String(text == null ? "" : text);
  if (!raw.trim()) return "Not detected in assigned PDF.";
  return raw.replace(/\b(LOW|MEDIUM|HIGH)\b/gi, (match, token) => {
    const upper = String(token).toUpperCase();
    const chipClass = getStrainChipClass(upper, category);
    return `<span class="chip inline-level-chip ${chipClass}">${upper}</span>`;
  });
}

function scoreBandLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Low";
  if (numeric >= 67) return "High";
  if (numeric >= 34) return "Medium";
  return "Low";
}

function firstPresentSnippet(values, fallback = "Not detected in parsed PDF text.") {
  for (const value of values) {
    const normalized = sanitizeSnippet(value || "", "");
    if (normalized) return normalized;
  }
  return fallback;
}

function isMissingExtractedText(value) {
  return /not detected/i.test(String(value || ""));
}

function isLikelyGarbledDevelopmentExerciseText(value) {
  const raw = String(value || "");
  const normalized = normalizeExtractedText(raw);
  if (!normalized) {
    return /copyright|integrative\s*enneagram|ben\s*russell|\b\d+\s*of\s*\d+\b/i.test(raw);
  }
  if (/copyright|integrative\s*enneagram|ben\s*russell/i.test(normalized)) return true;
  if (/\b\d+\s*of\s*\d+\b/i.test(normalized)) return true;
  const noisyTokenCount = normalized
    .split(/\s+/)
    .filter((token) => /[A-Za-z]{8,}\d+[A-Za-z]{5,}|[A-Za-z]{20,}/.test(token))
    .length;
  return noisyTokenCount >= 2;
}

function ensureSentenceStartsCapitalized(value) {
  const cleaned = sanitizeSnippet(value || "", "");
  if (!cleaned) return "";
  return cleaned.replace(/(^|[.!?]\s+)(["'(\[]*)([a-z])/g, (match, prefix, wrappers, firstChar) => (
    `${prefix || ""}${wrappers || ""}${String(firstChar || "").toUpperCase()}`
  ));
}

function splitDevelopmentExercisesTextBlock(value) {
  const normalized = normalizeExtractedText(value);
  if (!normalized) return [];
  const matches = [];
  const pattern =
    /DEVELOPMENT\s*EXERCISE(?:\s*\d+)?\s*[:\-]?\s*([\s\S]{16,520}?)(?=DEVELOPMENT\s*EXERCISE(?:\s*\d+)?\s*[:\-]?|$)/gi;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const cleaned = ensureSentenceStartsCapitalized(cleanPdfExtractedValue(match?.[1] || ""));
    if (!cleaned || isLikelyGarbledDevelopmentExerciseText(cleaned)) continue;
    matches.push(cleaned);
    if (matches.length >= 8) break;
  }
  if (!matches.length) {
    const cleaned = ensureSentenceStartsCapitalized(cleanPdfExtractedValue(normalized));
    if (cleaned && !isLikelyGarbledDevelopmentExerciseText(cleaned)) {
      matches.push(cleaned);
    }
  }
  return Array.from(new Set(matches)).map((text, index) => ({
    title: `Exercise ${index + 1}`,
    text,
  }));
}

function mergeFeedbackGuideRows(structuredRows, pdfRows) {
  const fallbackRows = Array.isArray(pdfRows) ? pdfRows : [];
  const primaryRows = Array.isArray(structuredRows) ? structuredRows : [];
  return Array.from({ length: 9 }, (_, index) => {
    const primary = primaryRows[index] || null;
    const fallback = fallbackRows[index] || null;
    const primaryGuidance = String(primary?.guidance || "");
    const guidance = !isMissingExtractedText(primaryGuidance)
      ? primaryGuidance
      : String(fallback?.guidance || primaryGuidance || "Not detected in assigned PDF.");
    return {
      type: primary?.type || fallback?.type || `Type ${index + 1}`,
      label: primary?.label || fallback?.label || "",
      guidance,
    };
  });
}

function mergeCategoryWriteups(structuredRows, pdfRows, categories) {
  const primaryRows = Array.isArray(structuredRows) ? structuredRows : [];
  const fallbackRows = Array.isArray(pdfRows) ? pdfRows : [];
  return categories.map((category) => {
    const primary = primaryRows.find((row) => String(row?.category || "").toLowerCase() === String(category).toLowerCase()) || null;
    const fallback = fallbackRows.find((row) => String(row?.category || "").toLowerCase() === String(category).toLowerCase()) || null;
    const primaryText = String(primary?.text || "");
    const fallbackText = String(fallback?.text || "");
    const usePrimary = !isMissingExtractedText(primaryText) && !isLowQualityStrainNarrative(primaryText, category);
    const useFallback = !isMissingExtractedText(fallbackText) && !isLowQualityStrainNarrative(fallbackText, category);
    const text = usePrimary
      ? primaryText
      : (useFallback ? fallbackText : String(primaryText || fallbackText || "Not detected in assigned PDF."));
    return { category, text };
  });
}

function shouldMergeDevelopmentExerciseFragment(previousText, nextText) {
  const prev = String(previousText || "").trim();
  const next = String(nextText || "").trim();
  if (!prev || !next) return false;
  if (/^[("'[\s]*[a-z]/.test(next)) return true;
  if (/^(?:and|or|but|which|that|to|with|for|of|the|a|an|your|you|this|these|those|it|its|in|on|at|by|from|if|when|because|while|as|so|then|than)\b/i.test(next)) {
    return true;
  }
  const prevEndsSentence = /[.!?]["')\]]?$/.test(prev);
  const prevWordCount = prev.split(/\s+/).filter(Boolean).length;
  const nextWordCount = next.split(/\s+/).filter(Boolean).length;
  if (!prevEndsSentence && prevWordCount <= 10) return true;
  if (!prevEndsSentence && nextWordCount <= 7) return true;
  return false;
}

function normalizeDevelopmentExerciseRows(rows, maxItems = 8) {
  const out = [];
  const inputRows = Array.isArray(rows) ? rows : [];
  for (const row of inputRows) {
    const candidate = ensureSentenceStartsCapitalized(cleanPdfExtractedValue(row?.text || row || ""));
    if (!candidate) continue;
    if (isMissingExtractedText(candidate) || isLikelyGarbledDevelopmentExerciseText(candidate)) continue;

    const previous = out[out.length - 1];
    if (previous && shouldMergeDevelopmentExerciseFragment(previous.text, candidate)) {
      previous.text = ensureSentenceStartsCapitalized(cleanPdfExtractedValue(`${previous.text} ${candidate}`));
      continue;
    }
    out.push({ text: candidate });
  }

  const deduped = [];
  const seen = new Set();
  for (const row of out) {
    const key = normalizeExtractedText(row?.text || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= maxItems) break;
  }

  return deduped.map((row, index) => ({
    title: `Exercise ${index + 1}`,
    text: ensureSentenceStartsCapitalized(row?.text || ""),
  }));
}

function mergeDevelopmentExercises(structuredExercises, pdfExercises) {
  const primaryRaw = Array.isArray(structuredExercises) ? structuredExercises : [];
  const fallbackRaw = Array.isArray(pdfExercises) ? pdfExercises : [];
  const primary = primaryRaw.flatMap((row) => {
    const split = splitDevelopmentExercisesTextBlock(row?.text);
    if (!split.length) return [row];
    return split;
  });
  const fallback = fallbackRaw.flatMap((row) => {
    const split = splitDevelopmentExercisesTextBlock(row?.text);
    if (!split.length) return [row];
    return split;
  });

  const merged = primary.filter(
    (row) => !isMissingExtractedText(row?.text) && !isLikelyGarbledDevelopmentExerciseText(row?.text),
  );
  const normalizedMerged = normalizeDevelopmentExerciseRows(merged, 8);
  if (normalizedMerged.length) return normalizedMerged;
  const fallbackFiltered = fallback.filter(
    (row) => !isMissingExtractedText(row?.text) && !isLikelyGarbledDevelopmentExerciseText(row?.text),
  );
  return normalizeDevelopmentExerciseRows(fallbackFiltered, 8);
}

function compactInsightSnippet(value, maxLength = 420) {
  const cleaned = cleanPdfExtractedValue(value || "");
  if (!cleaned) return null;
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trim()}...`;
}

function extractSectionInsightSnippet(parsedProfile, matcher) {
  if (!parsedProfile || typeof parsedProfile !== "object" || typeof matcher !== "function") return null;
  const sections = getReportContentSections(parsedProfile);
  for (const section of sections) {
    const sectionId = String(section?.sectionId || "").trim().toLowerCase();
    const sectionTitle = String(section?.sectionTitle || section?.title || "").trim().toLowerCase();
    if (!matcher({ sectionId, sectionTitle, section })) continue;
    const sectionText = getSectionCompositeText(parsedProfile, section) || section?.fullText || section?.summary || "";
    const snippet = compactInsightSnippet(sectionText);
    if (snippet) return snippet;
  }
  return null;
}

function buildProInsightsFromSources(parsedProfile, pdfText) {
  return {
    enneagramBasics: firstPresentSnippet([
      extractSectionInsightSnippet(parsedProfile, ({ sectionId, sectionTitle }) =>
        sectionId.includes("enneagram") ||
        sectionTitle.includes("enneagram basics") ||
        sectionTitle.includes("quick reference") ||
        sectionTitle.includes("subtypes"),
      ),
      extractSnippetFromLabels(pdfText, ["Quick reference", "all 9", "instinctual drives", "Social", "Self-Preservation"]),
      extractBetweenMarkers(pdfText, "27 Subtypes", "Centers of Expression"),
    ]),
    neurobiology: firstPresentSnippet([
      extractSectionInsightSnippet(parsedProfile, ({ sectionId, sectionTitle }) =>
        sectionId.includes("neuro") ||
        sectionTitle.includes("neurobiology") ||
        sectionTitle.includes("centers of expression"),
      ),
      extractSnippetFromLabels(pdfText, ["brainstem", "limbic", "prefrontal cortex", "Centers of Expression"]),
    ]),
    teamDynamics: firstPresentSnippet([
      extractSectionInsightSnippet(parsedProfile, ({ sectionId, sectionTitle }) =>
        sectionId === "team_dynamics" ||
        sectionTitle.includes("team dynamics") ||
        sectionTitle.includes("team behaviour") ||
        sectionTitle.includes("tuckman"),
      ),
      extractSnippetFromLabels(pdfText, ["Forming", "Storming", "Norming", "Performing", "Team Behaviour"]),
    ]),
    decisionFramework: firstPresentSnippet([
      extractSectionInsightSnippet(parsedProfile, ({ sectionId, sectionTitle }) =>
        sectionId.includes("decision") ||
        sectionTitle.includes("decision framework") ||
        sectionTitle.includes("decision making"),
      ),
      extractSnippetFromLabels(pdfText, ["Experience", "Intelligibility", "Commitment", "Decision Making"]),
    ]),
    strategicLeadership: firstPresentSnippet([
      extractSectionInsightSnippet(parsedProfile, ({ sectionId, sectionTitle }) =>
        sectionId === "strategic_leadership" || sectionTitle.includes("strategic leadership"),
      ),
      extractSnippetFromLabels(pdfText, ["Strategic Leadership", "Visioning", "Alignment", "Change Management"]),
    ]),
    coachingRelationship: firstPresentSnippet([
      extractSectionInsightSnippet(parsedProfile, ({ sectionId, sectionTitle }) =>
        sectionId === "coaching_relationship" || sectionTitle.includes("coaching relationship"),
      ),
      extractSnippetFromLabels(pdfText, ["Coaching Relationship", "coaching", "mentoring"]),
    ]),
    feedbackGuide: firstPresentSnippet([
      extractSectionInsightSnippet(parsedProfile, ({ sectionId, sectionTitle }) =>
        sectionId === "feedback_matrix" ||
        sectionTitle.includes("feedback guide") ||
        sectionTitle.includes("feedback matrix"),
      ),
      extractSnippetFromLabels(pdfText, ["Feedback Guide", "giving feedback", "all 9"]),
    ]),
    composite: firstPresentSnippet([
      extractSectionInsightSnippet(parsedProfile, ({ sectionTitle }) =>
        sectionTitle.includes("interaction styles") ||
        sectionTitle.includes("conflict") ||
        sectionTitle.includes("body language"),
      ),
      extractSnippetFromLabels(pdfText, ["Body Language", "eye contact", "larger-than-life"]),
      extractSnippetFromLabels(pdfText, ["Environmental Strain", "Happiness", "Vocational", "Interpersonal"]),
      extractSnippetFromLabels(pdfText, ["Development Exercise", "self-regulation"]),
    ]),
  };
}

function extractIndexedGuidanceRows(rawText, options) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const fallbackText = String(safeOptions.fallbackText || "Not detected in assigned PDF.");
  const names = safeOptions.names && typeof safeOptions.names === "object"
    ? safeOptions.names
    : {
        1: "Reformer",
        2: "Helper",
        3: "Achiever",
        4: "Individualist",
        5: "Investigator",
        6: "Loyalist",
        7: "Enthusiast",
        8: "Challenger",
        9: "Peacemaker",
      };
  const lineOriented = String(rawText || "")
    .replace(/\r/g, "\n")
    .replace(/\s+(Type\s*[1-9]\b)/gi, "\n$1")
    .replace(/\s+([1-9])\s+(?=[A-Z])/g, "\n$1 ");

  const rows = [];
  for (let type = 1; type <= 9; type += 1) {
    const typedPattern = new RegExp(
      `(?:^|\\n)\\s*Type\\s*${type}\\s*[:\\-\\)]?\\s*([\\s\\S]{10,420}?)(?=(?:\\n\\s*(?:Type\\s*[1-9]|[1-9]\\s+)|$))`,
      "i",
    );
    const numberedPattern = new RegExp(
      `(?:^|\\n)\\s*${type}\\s*(?:[\\.:\\-\\)])?\\s+([\\s\\S]{10,420}?)(?=(?:\\n\\s*(?:Type\\s*[1-9]|[1-9]\\s+)|$))`,
      "i",
    );
    const typedMatch = lineOriented.match(typedPattern);
    const numberedMatch = lineOriented.match(numberedPattern);
    const guidance = cleanPdfExtractedValue(typedMatch?.[1] || numberedMatch?.[1] || "") || fallbackText;
    rows.push({
      type: `Type ${type}`,
      label: names[type] || "",
      guidance,
    });
  }
  return rows;
}

function extractFeedbackGuideMatrix(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const names = {
    1: "Reformer",
    2: "Helper",
    3: "Achiever",
    4: "Individualist",
    5: "Investigator",
    6: "Loyalist",
    7: "Enthusiast",
    8: "Challenger",
    9: "Peacemaker",
  };
  const feedbackBlockMatch = normalized.match(
    /Feedback\s*Guide[\s\S]{20,8000}(?=\b(?:Conflict|Decision\s*Making|Leadership|Coaching\s*Relationship|Team\s*Behaviour)\b|$)/i,
  );
  const feedbackBlock = feedbackBlockMatch?.[0] || normalized;
  const indexedRows = extractIndexedGuidanceRows(feedbackBlock, {
    fallbackText: "Not detected in assigned PDF.",
    names,
  });
  if (indexedRows.some((row) => !isMissingExtractedText(row?.guidance))) {
    return indexedRows;
  }
  const rows = [];
  for (let type = 1; type <= 9; type += 1) {
    const pattern = new RegExp(`Type\\s*${type}\\b\\s*[:\\-]?\\s*([\\s\\S]{12,340}?)(?=Type\\s*[1-9]\\b|$)`, "i");
    const match = feedbackBlock.match(pattern);
    rows.push({
      type: `Type ${type}`,
      label: names[type],
      guidance: cleanPdfExtractedValue(match?.[1] || "") || "Not detected in assigned PDF.",
    });
  }

  const styleHeadingByType = {
    1: "Strict Perfectionist",
    2: "Considerate Helper",
    3: "Competitive Achiever",
    4: "Intense Creative",
    5: "Quiet Specialist",
    6: "Loyal Sceptic",
    7: "Enthusiastic Visionary",
    8: "Active Controller",
    9: "Adaptive Peacemaker",
  };
  const allHeadings = Object.values(styleHeadingByType);
  const styleText = feedbackBlock || normalized;
  for (let type = 1; type <= 9; type += 1) {
    if (!isMissingExtractedText(rows[type - 1]?.guidance)) continue;
    const heading = styleHeadingByType[type];
    const otherHeadings = allHeadings
      .filter((value) => value !== heading)
      .map((value) => escapeRegex(value))
      .join("|");
    const boundary = otherHeadings
      ? `(?:${otherHeadings}|Feedback\\s*Guide|$)`
      : "(?:Feedback\\s*Guide|$)";
    const stylePattern = new RegExp(`${escapeRegex(heading)}\\s*([\\s\\S]{24,960}?)(?=${boundary})`, "i");
    const styleMatch = styleText.match(stylePattern);
    const extracted = cleanPdfExtractedValue(styleMatch?.[1] || "");
    if (extracted) {
      rows[type - 1].guidance = extracted;
    }
  }
  return rows;
}

function extractStrainQualitativeWriteups(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const categories = [
    "Happiness",
    "Vocational",
    "Interpersonal",
    "Physical",
    "Environmental",
    "Psychological",
  ];
  const strainBlockMatch = normalized.match(
    /Strain\s*Profile[\s\S]{40,8000}(?=\b(?:Levels\s*of\s*Health|Integration|Wing\s*Influence|Connected\s*Line)\b|$)/i,
  );
  const strainBlock = strainBlockMatch?.[0] || normalized;

  return categories.map((category, index) => {
    const bulletNarrative = extractBulletStrainNarrative({
      text: strainBlock,
      category,
      nextCategories: categories.slice(index + 1),
    });
    if (bulletNarrative) {
      return { category, text: bulletNarrative };
    }

    const levelPattern = new RegExp(
      `perceived\\s+level\\s+of\\s+${escapeRegex(category)}\\s+strain\\s+is\\s+(LOW|MEDIUM|HIGH)\\.?([\\s\\S]{0,520}?)(?=Ben\\s+your\\s+perceived\\s+level\\s+of\\s+|The\\s+lines\\s+connecting|$)`,
      "i",
    );
    const levelMatch = normalized.match(levelPattern);
    if (levelMatch) {
      const prefix = `${category} strain is ${String(levelMatch[1] || "").toUpperCase()}.`;
      const detail = cleanPdfExtractedValue(levelMatch[2] || "");
      const combined = cleanPdfExtractedValue(`${prefix} ${detail}`) || prefix;
      return { category, text: combined };
    }

    const nextLabels = categories.slice(index + 1);
    const nextBoundary = nextLabels.length ? `(?:${nextLabels.map(escapeRegex).join("|")})\\b` : "$";
    const pattern = new RegExp(`${escapeRegex(category)}\\s*[:\\-]?\\s*([\\s\\S]{10,280}?)(?=\\s*${nextBoundary})`, "i");
    const match = strainBlock.match(pattern);
    const text =
      cleanPdfExtractedValue(match?.[1] || "") ||
      extractSnippetFromLabels(pdfText, [category, `${category} Strain`]) ||
      "Not detected in assigned PDF.";
    return { category, text };
  });
}

function summarizeOverallStrainText(rawText, options = {}) {
  const maxWords = Number.isFinite(Number(options?.maxWords))
    ? Math.max(12, Math.min(80, Number(options.maxWords)))
    : 36;
  let normalized = normalizeExtractedText(rawText || "");
  if (!normalized) return null;

  const categoryBoundary = normalized.match(
    /\b(?:Vocational|Environmental|Physical|Interpersonal|Psychological|Happiness)\s+Strain\b/i,
  );
  if (categoryBoundary?.index > 0) {
    normalized = normalizeExtractedText(normalized.slice(0, categoryBoundary.index));
  }
  if (!normalized) return null;

  const explicit = normalized.match(
    /overall\s+strain(?:\s+level)?\s*(?:is|appears|rated|of|at|was)?\s*(?:LOW|MEDIUM|HIGH|MODERATE)?\s*[:\-]?\s*([\s\S]{24,520})/i,
  );
  let summary = cleanPdfExtractedValue(explicit?.[1] || "");

  if (!summary) {
    const sentenceCandidates = (normalized.match(/[^.!?]{24,260}(?:[.!?]|$)/g) || [])
      .map((sentence) => cleanPdfExtractedValue(sentence))
      .filter(Boolean)
      .filter(
        (sentence) =>
          !/^\s*overall\s+strain(?:\s+level)?\s*(?:is|appears|rated|of|at|was)?\s*(?:low|medium|high|moderate)?\s*\.?\s*$/i.test(
            sentence,
          ),
      );
    const narrativeCandidates = sentenceCandidates.filter((sentence) =>
      /\b(?:you|your|cope|manage|demand|pressure|overwhelm|resilien|steady|optimism|circumstance|stress)\b/i.test(
        sentence,
      ),
    );
    summary = (narrativeCandidates.length ? narrativeCandidates : sentenceCandidates).slice(0, 2).join(" ");
  }

  summary = String(summary || "")
    .replace(
      /\boverall\s+strain(?:\s+level)?\s*(?:is|appears|rated|of|at|was)?\s*(?:low|medium|high|moderate)?\s*[:\-]?\s*/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!summary) return null;

  const words = summary.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    summary = `${words.slice(0, maxWords).join(" ")}...`;
  }
  return summary;
}

function extractOverallStrainSummaryFromReportContent(parsedProfile) {
  const strainSection = getSectionByTitle(parsedProfile, (title) => /strain/i.test(title));
  const overallInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.overallStrainSignal,
    { includeStartAnchor: true },
  );
  const summarySource = normalizeExtractedText(
    [
      overallInstructionText,
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.strainProfile.overall),
      getSectionCompositeText(parsedProfile, strainSection),
    ].join(" "),
  );
  return summarizeOverallStrainText(summarySource, { maxWords: 34 });
}

function extractOverallStrainSummaryFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText || "");
  if (!normalized) return null;
  const overallBlock = normalized.match(
    /Overall\s*Strain[\s\S]{24,1800}(?=\b(?:Vocational|Environmental|Physical|Interpersonal|Psychological|Happiness)\s+Strain\b|$)/i,
  );
  return summarizeOverallStrainText(overallBlock?.[0] || normalized, { maxWords: 34 });
}

function extractBulletItemsFromText(text, maxItems = 6) {
  const normalized = normalizeExtractedText(text || "");
  if (!normalized) return [];

  const out = [];
  const bulletPattern = /[•●▪◦·]\s*([^•●▪◦·]{12,260}?)(?=(?:\s*[•●▪◦·])|$)/g;
  let match;
  while ((match = bulletPattern.exec(normalized)) !== null) {
    const cleaned = cleanPdfExtractedValue(match?.[1] || "");
    if (cleaned) out.push(cleaned);
    if (out.length >= maxItems) break;
  }

  if (!out.length) {
    const sentencePattern =
      /\bYou\s+(?:are|feel|don't|do\s+not|may|wake|experience|want|have|struggle|work|tend)\b[^.?!]{12,260}(?:[.?!]|$)/gi;
    while ((match = sentencePattern.exec(normalized)) !== null) {
      const cleaned = cleanPdfExtractedValue(match?.[0] || "");
      if (cleaned) out.push(cleaned);
      if (out.length >= maxItems) break;
    }
  }

  return Array.from(new Set(out));
}

function extractBulletStrainNarrative({ text, category, nextCategories = [] }) {
  const normalized = normalizeExtractedText(text || "");
  if (!normalized || !category) return null;

  const nextBoundary = nextCategories.length
    ? `${nextCategories.map((next) => `${escapeRegex(next)}\\s+strain`).join("|")}|overall\\s+strain\\s+level|the\\s+lines\\s+connecting|copyright\\s*\\d{2,4}|$`
    : "overall\\s+strain\\s+level|the\\s+lines\\s+connecting|copyright\\s*\\d{2,4}|$";
  const patterns = [
    // Full section path: "<Category> Strain ... Ben your perceived level of <Category> strain is <LEVEL> ... bullets ..."
    new RegExp(
      `${escapeRegex(category)}\\s+strain[\\s\\S]{0,1800}?perceived\\s+level\\s+of\\s+${escapeRegex(category)}\\s+strain\\s+is\\s+(LOW|MEDIUM|HIGH|MODERATE)\\.?([\\s\\S]{0,2400}?)(?=\\s*(?:${nextBoundary}))`,
      "i",
    ),
    // Direct path: "Ben your perceived level of <Category> strain is <LEVEL> ... bullets ..."
    new RegExp(
      `Ben\\s+your\\s+perceived\\s+level\\s+of\\s+${escapeRegex(category)}\\s+strain\\s+is\\s+(LOW|MEDIUM|HIGH|MODERATE)\\.?([\\s\\S]{0,2400}?)(?=\\s*(?:${nextBoundary}))`,
      "i",
    ),
  ];

  for (const sectionPattern of patterns) {
    const sectionMatch = normalized.match(sectionPattern);
    if (!sectionMatch?.[1]) continue;
    const level = String(sectionMatch[1] || "").toUpperCase();
    const bulletItems = extractBulletItemsFromText(sectionMatch[2] || "", 6);
    if (!bulletItems.length) continue;
    return cleanPdfExtractedValue(
      `${category} strain is ${level}. ${bulletItems.map((item) => `• ${item}`).join(" ")}`,
    );
  }

  return null;
}

function isLowQualityStrainNarrative(value, category) {
  const text = cleanPdfExtractedValue(value || "") || "";
  if (!text) return true;
  const normalized = normalizeExtractedText(text).toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 36) return true;

  // Accept concise but valid narrative statements that explicitly anchor category + level.
  if (
    /^\s*(happiness|vocational|interpersonal|physical|environmental|psychological)\s+strain\s+is\s+(low|medium|high|moderate)\b/.test(
      normalized,
    ) &&
    normalized.split(/\s+/).filter(Boolean).length >= 9
  ) {
    return false;
  }

  const genericOnly = /^(?:strain|overall|level|happiness|vocational|interpersonal|physical|environmental|psychological|high|medium|low|moderate|and|the|is|of|:|;|,|\.|\s)+$/i;
  if (genericOnly.test(normalized)) return true;

  const categoryNames = ["happiness", "vocational", "interpersonal", "physical", "environmental", "psychological"];
  const categoryMentions = categoryNames.filter((name) => normalized.includes(name)).length;
  const words = normalized.split(/\s+/).filter(Boolean);

  // Label-chain artifacts often contain multiple category names but little/no narrative verbs.
  if (categoryMentions >= 2 && words.length < 18) return true;

  const expected = String(category || "").toLowerCase();
  const hasExpected = expected ? normalized.includes(expected) : true;
  const hasNarrativeSignal = /\b(?:you|your|experience|cope|react|impact|pressure|overwhelm|tend|likely|because|when|work|energy|relationship|context|demands|manageable|recovery)\b/.test(normalized);
  if (hasExpected && !hasNarrativeSignal && words.length < 20) return true;

  return false;
}

function extractDevelopmentExercises(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const matches = [];
  const pattern = /DEVELOPMENT\s*EXERCISE\s*[:\-]?\s*([\s\S]{16,420}?)(?=DEVELOPMENT\s*EXERCISE|Connected\s*Line|Key\s*Challenges|$)/gi;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    const cleaned = cleanPdfExtractedValue(match[1]);
    if (!cleaned || isLikelyGarbledDevelopmentExerciseText(cleaned)) continue;
    matches.push(cleaned);
    if (matches.length >= 8) break;
  }

  if (!matches.length) {
    const fallback = extractSnippetFromLabels(pdfText, [
      "Development Exercise",
      "self-regulation",
      "balancing centers",
      "strategic leadership",
    ]);
    const cleanedFallback = cleanPdfExtractedValue(fallback || "");
    if (cleanedFallback && !isLikelyGarbledDevelopmentExerciseText(cleanedFallback)) {
      matches.push(cleanedFallback);
    }
  }

  return Array.from(new Set(matches)).map((text, index) => ({
    title: `Exercise ${index + 1}`,
    text,
  }));
}

function getReportContentSections(parsedProfile) {
  return Array.isArray(parsedProfile?.reportContent?.sections) ? parsedProfile.reportContent.sections : [];
}

function getReportContentPages(parsedProfile) {
  return Array.isArray(parsedProfile?.reportContent?.pages) ? parsedProfile.reportContent.pages : [];
}

const PDF_PAGE_ANCHORS = {
  coreType: [6, 7, 8, 9],
  subtypesInstincts: [10, 11],
  centersOfExpression: [12, 13, 14],
  decisionMaking: [32, 33, 34],
  leadershipManagement: [35, 36, 37, 38],
  teamBehaviour: [39, 40, 41],
  coachingRelationship: [42],
  givingReceivingFeedback: [26, 27],
  conflictTriggers: [30, 31],
  selfAwarenessIntegration: [16, 17],
  strainProfile: {
    overall: [18, 34],
    vocational: [19, 20],
    environmental: [19, 20],
    physical: [20, 21],
    interpersonal: [20, 21],
    psychological: [21, 22],
    happiness: [21, 22],
  },
  communication: [24],
  feedbackGuide: [28, 29],
  developmentExercises: [7, 11, 13, 17, 19, 28, 31, 36, 38],
};

const ASSIGNED_PDF_INSTRUCTION_RULES = {
  motivationSummary: {
    pageNumbers: [6],
    startAnchor: "Motivation",
    endAnchor: "Typical Action Patterns",
    mode: "single_snippet",
  },
  instinctGoals: {
    pageNumbers: [10],
    startAnchor: "Ben, you are an Enneagram type",
    endAnchor: "Definitions of the three instinctual goals",
    mode: "single_snippet",
  },
  developingAsCopy: {
    pageNumbers: [11],
    startAnchor: "Development Exercise",
    endAnchor: "end of page",
    mode: "bullets",
  },
  responseToConflict: {
    pageNumbers: [30],
    startAnchor: "Response to Conflict",
    endAnchor: "What triggers you",
    mode: "bullets",
  },
  whatYouDoWhenTriggered: {
    pageNumbers: [30, 31],
    startAnchor: "What you do when triggered",
    endAnchor: "What others should do",
    preferHeadingStart: true,
    mode: "bullets",
  },
  conflictTriggersBullets: {
    pageNumbers: [30, 31],
    startAnchor: "What triggers you",
    endAnchor: "What you do when triggered",
    preferHeadingStart: true,
    mode: "bullets",
  },
  teamStages: {
    pageNumbers: [40, 41],
    startAnchor: "Forming",
    endAnchor: "end of page",
    preferHeadingStart: true,
    mode: "full_page",
  },
  centeredDecisions: {
    pageNumbers: [32],
    startAnchor: "Decision Making",
    endAnchor: "end of page",
    mode: "full_page",
  },
  impactOfEnneaStyle: {
    pageNumbers: [33],
    startAnchor: "Impact",
    endAnchor: "end of page",
    mode: "full_page",
  },
  overallStrainSignal: {
    pageNumbers: [18, 34],
    startAnchor: "Ben your perceived level of Overall strain",
    endAnchor: "end of page",
    mode: "single_snippet",
  },
  strategicLeadershipCopy: {
    pageNumbers: [37, 38],
    startAnchor: "Strategic Leadership",
    endAnchor: "end of page",
    mode: "full_page",
  },
  teamImpactCopy: {
    pageNumbers: [39],
    startAnchor: "Your Impact on Team",
    endAnchor: "Team Role",
    mode: "single_snippet",
  },
  interdependenceCopy: {
    pageNumbers: [39],
    startAnchor: "Team Role",
    endAnchor: "end of page",
    mode: "single_snippet",
  },
  coachingRelationshipCopy: {
    pageNumbers: [42],
    startAnchor: "Ben, as an Ennea",
    endAnchor: "end of page",
    mode: "single_snippet",
  },
  bodyLanguageRows: {
    pageNumbers: [25],
    startAnchor: "Body Language",
    endAnchor: "end of page",
    mode: "bullets",
  },
  feedbackGuide: {
    pageNumbers: [28, 29],
    startAnchor: "Feedback Guide",
    endAnchor: "end of page",
    mode: "full_page",
  },
  environmentalStrain: {
    pageNumbers: [19, 20],
    startAnchor: "Ben your perceived level of Environmental strain",
    endAnchor: "Ben your perceived level of Vocational strain",
    preferHeadingStart: true,
    mode: "bullets",
  },
  vocationalStrain: {
    pageNumbers: [19, 20],
    startAnchor: "Ben your perceived level of Vocational strain",
    endAnchor: "Environmental Strain",
    preferHeadingStart: true,
    mode: "bullets",
  },
  physicalStrain: {
    pageNumbers: [20, 21],
    startAnchor: "Ben your perceived level of Physical strain",
    endAnchor: "Ben your perceived level of Interpersonal strain",
    preferHeadingStart: true,
    mode: "bullets",
  },
  interpersonalStrain: {
    pageNumbers: [20, 21],
    startAnchor: "Ben your perceived level of Interpersonal strain",
    endAnchor: "Physical Strain",
    preferHeadingStart: true,
    mode: "bullets",
  },
  psychologicalStrain: {
    pageNumbers: [21, 22],
    startAnchor: "Ben your perceived level of Psychological strain",
    endAnchor: "Ben your perceived level of Happiness strain",
    preferHeadingStart: true,
    mode: "bullets",
  },
  happinessStrain: {
    pageNumbers: [21, 22],
    startAnchor: "Ben your perceived level of Happiness strain",
    endAnchor: "Psychological Strain",
    preferHeadingStart: true,
    mode: "bullets",
  },
  developmentExercises: {
    pageNumbers: [7, 11, 13, 17, 19, 28, 31, 36, 38],
    startAnchor: "DEVELOPMENT EXERCISE",
    endAnchor: "end of page",
    mode: "bullets",
  },
};

function getReportPageTextByNumber(parsedProfile) {
  const map = new Map();
  const pages = getReportContentPages(parsedProfile);
  pages.forEach((page) => {
    const pageNumber = Number(page?.pageNumber ?? page?.pageNum);
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) return;
    const pageText = stripPdfFooterNoiseFragments(
      [
        page?.heading,
        page?.sectionTitle,
        page?.extractedText,
        page?.text,
        ...(Array.isArray(page?.keyDataPoints) ? page.keyDataPoints : []),
      ]
        .filter(Boolean)
        .join("\n"),
    )
      .replace(/\u0000/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/\b(?:[A-Za-z](?:[ \t]+)){2,}[A-Za-z]\b/g, (match) => {
        const source = String(match || "");
        const marked = source.replace(/[ \t]{2,}/g, "\u0000");
        const collapsed = marked.replace(/[ \t]+/g, "");
        if (!collapsed.includes("\u0000") && collapsed.length >= 24) {
          return source.replace(/[ \t]+/g, " ").trim();
        }
        return collapsed.replace(/\u0000/g, " ");
      })
      .replace(/\b(?:\d(?:[ \t]+)){2,}\d\b/g, (match) => {
        const marked = String(match || "").replace(/[ \t]{2,}/g, "\u0000");
        return marked.replace(/[ \t]+/g, "").replace(/\u0000/g, " ");
      })
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!pageText) return;
    const existing = map.get(pageNumber);
    map.set(pageNumber, existing ? `${existing}\n${pageText}`.trim() : pageText);
  });
  return map;
}

function normalizeInstructionAnchor(anchor) {
  const value = String(anchor || "").trim();
  if (!value) return "";
  if (/^full\s*page$/i.test(value)) return "";
  if (/^\*?\s*end\s*of\s*page$/i.test(value)) return "end_of_page";
  return value;
}

function resolveInstructionPageCandidates(pageNumbers, availablePageNumbers, radius = 2) {
  const base = Array.isArray(pageNumbers)
    ? pageNumbers.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const available = new Set((Array.isArray(availablePageNumbers) ? availablePageNumbers : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0));
  const out = new Set();
  base.forEach((page) => {
    if (available.has(page)) out.add(page);
    for (let step = 1; step <= radius; step += 1) {
      if (available.has(page - step)) out.add(page - step);
      if (available.has(page + step)) out.add(page + step);
    }
  });
  return Array.from(out).sort((a, b) => a - b);
}

function findInstructionAnchorMatch(text, anchor, options = {}) {
  const source = String(text || "");
  const value = normalizeInstructionAnchor(anchor);
  if (!source || !value || value === "end_of_page") return null;
  const startIndex = Number.isFinite(Number(options?.startIndex)) ? Number(options.startIndex) : 0;
  const preferHeading = Boolean(options?.preferHeading);
  const phrasePattern = buildFlexibleLabelPattern(value);
  if (!phrasePattern) return null;
  const regex = new RegExp(phrasePattern, "ig");
  let match;
  while ((match = regex.exec(source)) !== null) {
    const index = Number(match?.index || 0);
    if (index < startIndex) continue;
    if (preferHeading) {
      const lastBreak = Math.max(source.lastIndexOf("\n", index), source.lastIndexOf("\r", index));
      const linePrefix = source.slice(lastBreak + 1, index).trim();
      if (linePrefix.length > 0) continue;
    }
    return { index, length: String(match?.[0] || "").length };
  }
  return null;
}

function extractInstructionTextFromReportContent(parsedProfile, rule, options = {}) {
  const safeRule = rule && typeof rule === "object" ? rule : {};
  const pageTextMap = getReportPageTextByNumber(parsedProfile);
  const availablePages = Array.from(pageTextMap.keys()).sort((a, b) => a - b);
  if (!availablePages.length) return null;

  const basePages = Array.isArray(safeRule.pageNumbers)
    ? safeRule.pageNumbers.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const candidatePages = resolveInstructionPageCandidates(basePages, availablePages, Number(safeRule.searchRadius || 2));
  const selectedPages = candidatePages.length ? candidatePages : availablePages;
  const pageSegments = selectedPages
    .map((pageNumber) => ({ pageNumber, text: String(pageTextMap.get(pageNumber) || "").trim() }))
    .filter((segment) => Boolean(segment.text));
  if (!pageSegments.length) return null;

  const startAnchor = normalizeInstructionAnchor(safeRule.startAnchor);
  const endAnchor = normalizeInstructionAnchor(safeRule.endAnchor);
  const includeStartAnchor = Boolean(options?.includeStartAnchor ?? safeRule.includeStartAnchor);
  const includeEndAnchor = Boolean(options?.includeEndAnchor ?? safeRule.includeEndAnchor);
  const shouldRequireStartAnchor = Boolean(startAnchor && startAnchor !== "end_of_page");

  const extractFromSource = (sourceText) => {
    const source = String(sourceText || "").trim();
    if (!source) return null;
    let startIndex = 0;
    let startMatched = !shouldRequireStartAnchor;
    if (startAnchor) {
      const startMatch = findInstructionAnchorMatch(source, startAnchor, {
        startIndex: 0,
        preferHeading: Boolean(safeRule.preferHeadingStart),
      });
      if (startMatch) {
        startMatched = true;
        startIndex = includeStartAnchor ? startMatch.index : startMatch.index + startMatch.length;
      }
    }
    if (!startMatched) return null;

    let endIndex = source.length;
    if (endAnchor && endAnchor !== "end_of_page") {
      const endMatch = findInstructionAnchorMatch(source, endAnchor, {
        startIndex,
        preferHeading: Boolean(safeRule.preferHeadingEnd),
      });
      if (endMatch) {
        endIndex = includeEndAnchor ? endMatch.index + endMatch.length : endMatch.index;
      }
    }
    const snippet = String(source.slice(startIndex, endIndex) || "").trim();
    if (!snippet) return null;
    if (options?.raw) return snippet;
    if (safeRule.mode === "bullets") {
      const bulletRows = extractBulletItemsFromText(snippet, Number(safeRule.maxItems || 8));
      if (bulletRows.length) {
        return bulletRows.join(" ");
      }
    }
    return cleanPdfExtractedValue(snippet) || null;
  };

  const preferredStartPages = basePages.length
    ? basePages
    : [pageSegments[0].pageNumber];
  const startPageOrder = Array.from(
    new Set([
      ...preferredStartPages,
      ...pageSegments.map((segment) => segment.pageNumber),
    ]),
  );

  for (const startPage of startPageOrder) {
    const startIndex = pageSegments.findIndex((segment) => segment.pageNumber === startPage);
    if (startIndex === -1) continue;
    const snippet = extractFromSource(
      pageSegments
        .slice(startIndex)
        .map((segment) => segment.text)
        .join("\n\n"),
    );
    if (snippet) return snippet;
  }

  const fallback = extractFromSource(
    pageSegments
      .map((segment) => segment.text)
      .join("\n\n"),
  );
  return fallback || null;
}

function extractInstructionBulletRowsFromReportContent(parsedProfile, rule, maxItems = 8) {
  const raw = extractInstructionTextFromReportContent(parsedProfile, {
    ...(rule && typeof rule === "object" ? rule : {}),
    mode: "full_page",
  }, { includeStartAnchor: true, raw: true });
  const text = normalizeExtractedText(raw || "");
  if (!text) return [];
  const starBulletRows = String(raw || "")
    .split(/\n+/)
    .map((line) => cleanPdfExtractedValue(line.replace(/^\s*\*\s*/, "")))
    .filter((line) => Boolean(line))
    .filter((line) => !/^development\s*exercise$/i.test(line));
  const symbolRows = extractBulletItemsFromText(text, maxItems);
  return Array.from(new Set([...symbolRows, ...starBulletRows])).slice(0, maxItems);
}

function getPageAnchoredText(parsedProfile, pageNumbers) {
  const desired = new Set((Array.isArray(pageNumbers) ? pageNumbers : []).map((n) => Number(n)));
  if (!desired.size) return "";
  const pages = getReportContentPages(parsedProfile);
  return normalizeExtractedText(
    pages
      .filter((page) => desired.has(Number(page?.pageNumber ?? page?.pageNum)))
      .map((page) =>
        [page?.heading, page?.sectionTitle, page?.extractedText, page?.text, ...(Array.isArray(page?.keyDataPoints) ? page.keyDataPoints : [])]
          .filter(Boolean)
          .join(" "),
      )
      .join(" "),
  );
}

function extractMetaMessageFromReportContent(parsedProfile) {
  const communicationSection = getSectionByTitle(parsedProfile, (title) => /communication|feedback/i.test(title));
  const text = normalizeExtractedText(
    [
      getSectionCompositeText(parsedProfile, communicationSection),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.communication),
    ].join(" "),
  );
  if (!text) return null;

  const patterns = [
    /YOUR\s*META[-\s]?MESSAGE\s*[:\-]?\s*([^\n]{8,260})/i,
    /\bMeta[-\s]?Message\s*[:\-]?\s*([^\n]{8,260})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = cleanPdfExtractedValue(match?.[1] || "");
    if (candidate) return cleanupMetaQuote(candidate);
  }

  const fallback = extractSnippetFromLabels(text, ["YOUR META-MESSAGE", "Meta Message", "Meta-message"]);
  return fallback ? cleanupMetaQuote(fallback) : null;
}

function getSectionByTitle(parsedProfile, matcher) {
  const sections = getReportContentSections(parsedProfile);
  return sections.find((section) => matcher(String(section?.sectionTitle || section?.title || ""))) || null;
}

function getSectionCompositeText(parsedProfile, section) {
  if (!section || typeof section !== "object") return "";
  const sectionsText = [section?.fullText, section?.summary, section?.text].filter(Boolean).join(" ");
  const pages = getReportContentPages(parsedProfile);
  const start = Number(section?.pageStart || NaN);
  const end = Number(section?.pageEnd || NaN);
  const inRangePageText = pages
    .filter((page) => {
      const n = Number(page?.pageNumber || NaN);
      if (!Number.isFinite(n)) return false;
      if (Number.isFinite(start) && n < start) return false;
      if (Number.isFinite(end) && n > end) return false;
      return true;
    })
    .map((page) => [page?.heading, page?.extractedText, ...(Array.isArray(page?.keyDataPoints) ? page.keyDataPoints : [])].filter(Boolean).join(" "))
    .join(" ");
  return normalizeExtractedText(`${sectionsText} ${inRangePageText}`);
}

function extractFeedbackGuideFromReportContent(parsedProfile) {
  const feedbackGuideInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.feedbackGuide,
    { includeStartAnchor: true },
  );
  const feedbackGuidePageText = getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.feedbackGuide);
  const feedbackSection = getSectionByTitle(parsedProfile, (title) =>
    /feedback\s*guide|feedback\s*matrix|giving\s*&?\s*receiving\s*feedback/i.test(title),
  );
  const fallbackFeedbackText = normalizeExtractedText(
    [
      getSectionCompositeText(parsedProfile, feedbackSection),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.communication),
    ].join(" "),
  );
  const text = feedbackGuideInstructionText || feedbackGuidePageText || fallbackFeedbackText;
  if (!text) {
    return Array.from({ length: 9 }, (_, idx) => ({
      type: `Type ${idx + 1}`,
      label: "",
      guidance: "Not detected in structured report content.",
    }));
  }

  const names = {
    1: "Reformer",
    2: "Helper",
    3: "Achiever",
    4: "Individualist",
    5: "Investigator",
    6: "Loyalist",
    7: "Enthusiast",
    8: "Challenger",
    9: "Peacemaker",
  };

  const feedbackBlockMatch = text.match(
    /Feedback\s*Guide[\s\S]{20,8000}(?=\b(?:Conflict|Decision\s*Making|Leadership|Coaching\s*Relationship|Team\s*Behaviour)\b|$)/i,
  );
  const feedbackBlock = feedbackBlockMatch?.[0] || text;

  const indexedRows = extractIndexedGuidanceRows(feedbackBlock, {
    fallbackText: "Not detected in structured report content.",
    names,
  });
  if (indexedRows.some((row) => !isMissingExtractedText(row?.guidance))) {
    return indexedRows;
  }

  const rows = [];
  for (let type = 1; type <= 9; type += 1) {
    const pattern = new RegExp(`Type\\s*${type}\\b\\s*[:\\-]?\\s*([\\s\\S]{10,320}?)(?=Type\\s*[1-9]\\b|$)`, "i");
    const match = feedbackBlock.match(pattern);
    rows.push({
      type: `Type ${type}`,
      label: names[type],
      guidance: cleanPdfExtractedValue(match?.[1] || "") || "Not detected in structured report content.",
    });
  }
  return rows;
}

function extractTeamStageSnippet(text, stage, nextStages = []) {
  const normalized = normalizeExtractedText(text || "");
  if (!normalized || !stage) return null;

  const boundaryStages = Array.isArray(nextStages) ? nextStages.filter(Boolean) : [];
  const boundaryPattern = boundaryStages.length
    ? `${boundaryStages.map((value) => buildFlexiblePhrasePattern(value)).join("|")}|coaching\\s*relationship|strategic\\s*leadership|decision\\s*making|$`
    : "coaching\\s*relationship|strategic\\s*leadership|decision\\s*making|$";

  const blockPattern = new RegExp(
    `${buildFlexiblePhrasePattern(stage)}\\s*[:\\-]?\\s*([\\s\\S]{22,840}?)(?=\\s*(?:${boundaryPattern}))`,
    "i",
  );
  const blockMatch = normalized.match(blockPattern);
  const direct = cleanPdfExtractedValue(blockMatch?.[1] || "");
  if (direct) return direct;

  const fallback = extractSnippetFromLabels(normalized, [stage]);
  return cleanPdfExtractedValue(fallback || "") || null;
}

function getTargetedSections(parsedProfile) {
  const targeted = parsedProfile?.targetedSections;
  return targeted && typeof targeted === "object" ? targeted : {};
}

function normalizeTargetedSectionRows(value, options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const maxItems = Number.isFinite(Number(safeOptions.maxItems)) ? Number(safeOptions.maxItems) : 8;
  const maxLength = Number.isFinite(Number(safeOptions.maxLength)) ? Number(safeOptions.maxLength) : 240;
  const values = Array.isArray(value) ? value : [value];
  const rows = values
    .map((item) => cleanPdfExtractedValue(item || ""))
    .filter(Boolean)
    .filter((item) => !isMissingExtractedText(item))
    .map((item) => compactInsightSnippet(item, maxLength))
    .filter(Boolean);
  return Array.from(new Set(rows)).slice(0, maxItems);
}

function compactTargetedSectionText(value, options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const maxLength = Number.isFinite(Number(safeOptions.maxLength)) ? Number(safeOptions.maxLength) : 420;
  const maxItems = Number.isFinite(Number(safeOptions.maxItems)) ? Number(safeOptions.maxItems) : 8;
  const joiner = String(safeOptions.joiner || " ");
  const rows = normalizeTargetedSectionRows(value, { maxItems, maxLength });
  if (!rows.length) return null;
  return compactInsightSnippet(rows.join(joiner), maxLength);
}

function extractTeamStageBreakdownFromTargetedSections(parsedProfile) {
  const teamDynamics = getTargetedSections(parsedProfile)?.team_dynamics;
  if (!teamDynamics || typeof teamDynamics !== "object") return null;
  const result = {
    forming: compactTargetedSectionText(teamDynamics.forming),
    storming: compactTargetedSectionText(teamDynamics.storming),
    norming: compactTargetedSectionText(teamDynamics.norming),
    performing: compactTargetedSectionText(teamDynamics.performing),
  };
  console.log("[team-stage] targeted-section extraction", {
    hasForming: Boolean(result.forming),
    hasStorming: Boolean(result.storming),
    hasNorming: Boolean(result.norming),
    hasPerforming: Boolean(result.performing),
  });
  if (Object.values(result).every((value) => !value)) return null;
  return result;
}

function extractFeedbackGuideFromTargetedSections(parsedProfile) {
  const guide = getTargetedSections(parsedProfile)?.feedback_guide;
  if (!guide || typeof guide !== "object") return [];

  const names = {
    1: "Reformer",
    2: "Helper",
    3: "Achiever",
    4: "Individualist",
    5: "Investigator",
    6: "Loyalist",
    7: "Enthusiast",
    8: "Challenger",
    9: "Peacemaker",
  };

  const rows = Array.from({ length: 9 }, (_, index) => {
    const type = index + 1;
    const guidance = compactTargetedSectionText(guide?.[`type_${type}`], { maxItems: 12, maxLength: 620 });
    return {
      type: `Type ${type}`,
      label: names[type],
      guidance: guidance || "Not detected in structured report content.",
    };
  });

  console.log("[feedback-guide] targeted-section extraction", {
    populatedRows: rows.filter((row) => !isMissingExtractedText(row?.guidance)).length,
  });
  return rows;
}

function extractDevelopmentExercisesFromTargetedSections(parsedProfile) {
  const development = getTargetedSections(parsedProfile)?.development_exercises;
  if (!development || typeof development !== "object") return [];

  const groups = [
    "core_type",
    "subtype",
    "centers",
    "integration",
    "strain",
    "conflict",
    "management",
    "strategic_leadership",
  ];
  const out = [];
  groups.forEach((group) => {
    const rows = normalizeTargetedSectionRows(development?.[group], { maxItems: 8, maxLength: 420 });
    rows.forEach((row) => {
      out.push({
        title: `Exercise ${out.length + 1}`,
        text: row,
      });
    });
  });

  console.log("[development-exercises] targeted-section extraction", {
    rows: out.length,
    groupsHydrated: groups.filter((group) => normalizeTargetedSectionRows(development?.[group], { maxItems: 1 }).length).length,
  });
  return out;
}

function extractSpreadsheetSectionFocusesFromTargetedSections(parsedProfile) {
  const targeted = getTargetedSections(parsedProfile);
  const decision = targeted?.decision_framework && typeof targeted.decision_framework === "object"
    ? targeted.decision_framework
    : {};
  const strategic = targeted?.strategic_leadership && typeof targeted.strategic_leadership === "object"
    ? targeted.strategic_leadership
    : {};
  const team = targeted?.team_dynamics && typeof targeted.team_dynamics === "object"
    ? targeted.team_dynamics
    : {};
  const development = targeted?.development_exercises && typeof targeted.development_exercises === "object"
    ? targeted.development_exercises
    : {};

  const conflictRows = normalizeTargetedSectionRows(development.conflict, { maxItems: 8, maxLength: 220 });
  const strategicRows = [
    ...normalizeTargetedSectionRows(strategic.visioning, { maxItems: 6, maxLength: 220 }),
    ...normalizeTargetedSectionRows(strategic.strategic_thinking, { maxItems: 6, maxLength: 220 }),
    ...normalizeTargetedSectionRows(strategic.alignment, { maxItems: 6, maxLength: 220 }),
    ...normalizeTargetedSectionRows(strategic.change_management, { maxItems: 6, maxLength: 220 }),
  ];
  const teamImpactRows = [
    ...normalizeTargetedSectionRows(team.forming, { maxItems: 6, maxLength: 220 }),
    ...normalizeTargetedSectionRows(team.norming, { maxItems: 6, maxLength: 220 }),
    ...normalizeTargetedSectionRows(team.performing, { maxItems: 6, maxLength: 220 }),
  ];
  const decisionImpactRows = [
    ...normalizeTargetedSectionRows(decision.making_decisions, { maxItems: 6, maxLength: 220 }),
    ...normalizeTargetedSectionRows(decision.receiving_decisions, { maxItems: 6, maxLength: 220 }),
  ];

  const focused = {
    motivationSummary: null,
    instinctGoals: null,
    developingAsCopy: compactTargetedSectionText(development.subtype, { maxItems: 8, maxLength: 420 }),
    bodyLanguageRows: normalizeTargetedSectionRows(targeted.body_language, { maxItems: 10, maxLength: 210 }),
    conflictResponseCopy: compactTargetedSectionText(conflictRows.slice(0, 5), { maxItems: 5, maxLength: 420 }),
    conflictTriggeredCopy: compactTargetedSectionText(conflictRows, { maxItems: 8, maxLength: 420 }),
    centeredDecisionCopy: compactTargetedSectionText(decision.dominant_center_impact, { maxItems: 6, maxLength: 420 }),
    decisionImpactCopy: compactTargetedSectionText(decisionImpactRows, { maxItems: 8, maxLength: 420 }),
    decisionStrainCopy: compactTargetedSectionText(decision.strain_impact, { maxItems: 6, maxLength: 420 }),
    strategicLeadershipCopy: compactTargetedSectionText(strategicRows, { maxItems: 10, maxLength: 420 }),
    teamImpactCopy: compactTargetedSectionText(teamImpactRows, { maxItems: 8, maxLength: 420 }),
    interdependenceCopy: compactTargetedSectionText(team.interdependence_and_role, { maxItems: 3, maxLength: 420 }),
    coachingRelationshipCopy: compactTargetedSectionText(targeted.coaching_relationship, { maxItems: 8, maxLength: 420 }),
  };

  console.log("[spreadsheet-focus] targeted-section extraction", {
    hasDevelopingAs: Boolean(focused.developingAsCopy),
    bodyLanguageRows: focused.bodyLanguageRows.length,
    hasConflictResponse: Boolean(focused.conflictResponseCopy),
    hasCenteredDecision: Boolean(focused.centeredDecisionCopy),
    hasDecisionImpact: Boolean(focused.decisionImpactCopy),
    hasStrategicLeadership: Boolean(focused.strategicLeadershipCopy),
    hasTeamImpact: Boolean(focused.teamImpactCopy),
    hasInterdependence: Boolean(focused.interdependenceCopy),
    hasCoachingRelationship: Boolean(focused.coachingRelationshipCopy),
  });
  return focused;
}

function extractTeamStageBreakdownFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText || "");
  if (!normalized) return null;
  const stageLabels = ["Forming", "Storming", "Norming", "Performing"];
  const lowerPriorityBlockMatch = normalized.match(
    /Team\s*Behaviour[\s\S]{36,3600}(?=\b(?:Coaching\s*Relationship|Strategic\s*Leadership|Feedback\s*Guide|$))/i,
  );
  const block = lowerPriorityBlockMatch?.[0] || normalized;

  const result = {
    forming: extractTeamStageSnippet(block, stageLabels[0], stageLabels.slice(1)),
    storming: extractTeamStageSnippet(block, stageLabels[1], stageLabels.slice(2)),
    norming: extractTeamStageSnippet(block, stageLabels[2], stageLabels.slice(3)),
    performing: extractTeamStageSnippet(block, stageLabels[3], []),
  };
  if (Object.values(result).every((value) => !value)) return null;
  return result;
}

function extractTeamStageBreakdownFromReportContent(parsedProfile) {
  const teamSection = getSectionByTitle(parsedProfile, (title) =>
    /team\s*behavio[u]?r|team\s*dynamics|forming|storming|norming|performing/i.test(title),
  );
  const teamInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.teamStages,
    { includeStartAnchor: true },
  );
  const text = normalizeExtractedText(
    [
      teamInstructionText,
      getSectionCompositeText(parsedProfile, teamSection),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.teamBehaviour),
    ].join(" "),
  );
  if (!text) return null;

  const stageLabels = ["Forming", "Storming", "Norming", "Performing"];
  const result = {
    forming: extractTeamStageSnippet(text, stageLabels[0], stageLabels.slice(1)),
    storming: extractTeamStageSnippet(text, stageLabels[1], stageLabels.slice(2)),
    norming: extractTeamStageSnippet(text, stageLabels[2], stageLabels.slice(3)),
    performing: extractTeamStageSnippet(text, stageLabels[3], []),
  };
  console.log("[team-stage] extracted stage snippets from structured content", {
    hasForming: Boolean(result.forming),
    hasStorming: Boolean(result.storming),
    hasNorming: Boolean(result.norming),
    hasPerforming: Boolean(result.performing),
  });
  if (Object.values(result).every((value) => !value)) return null;
  return result;
}

function mergeTeamStageBreakdown(structuredBreakdown, pdfBreakdown) {
  const structured = structuredBreakdown && typeof structuredBreakdown === "object" ? structuredBreakdown : {};
  const pdf = pdfBreakdown && typeof pdfBreakdown === "object" ? pdfBreakdown : {};
  const fallback = "Not detected in assigned PDF.";
  return {
    forming: firstPresentSnippet([structured.forming, pdf.forming], fallback),
    storming: firstPresentSnippet([structured.storming, pdf.storming], fallback),
    norming: firstPresentSnippet([structured.norming, pdf.norming], fallback),
    performing: firstPresentSnippet([structured.performing, pdf.performing], fallback),
  };
}

function extractSpreadsheetFocusSourceText(parsedProfile, options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const sectionMatchers = Array.isArray(safeOptions.sectionMatchers) ? safeOptions.sectionMatchers : [];
  const pageAnchors = Array.isArray(safeOptions.pageAnchors) ? safeOptions.pageAnchors : [];
  const sections = getReportContentSections(parsedProfile);
  const sectionText = sections
    .filter((section) => {
      if (!sectionMatchers.length) return false;
      const sectionId = String(section?.sectionId || "").trim().toLowerCase();
      const sectionTitle = String(section?.sectionTitle || section?.title || "").trim().toLowerCase();
      return sectionMatchers.some((matcher) => {
        if (matcher instanceof RegExp) return matcher.test(sectionTitle) || matcher.test(sectionId);
        const keyword = String(matcher || "").trim().toLowerCase();
        if (!keyword) return false;
        return sectionTitle.includes(keyword) || sectionId.includes(keyword);
      });
    })
    .map((section) => getSectionCompositeText(parsedProfile, section))
    .filter(Boolean)
    .join(" ");

  const pageText = getPageAnchoredText(parsedProfile, pageAnchors);
  return normalizeExtractedText(`${sectionText} ${pageText}`);
}

function extractSpreadsheetSnippetFromText(rawText, labels = [], maxLength = 420) {
  const normalized = normalizeExtractedText(rawText || "");
  if (!normalized) return null;
  const labelMatches = Array.isArray(labels) ? labels : [];
  for (const label of labelMatches) {
    const snippet = cleanPdfExtractedValue(extractSnippetFromLabels(normalized, [label]) || "");
    if (snippet) return compactInsightSnippet(snippet, maxLength);
  }
  return compactInsightSnippet(normalized, maxLength);
}

function extractInstinctGoalDefinitions(rawText) {
  const normalized = normalizeExtractedText(rawText || "");
  if (!normalized) return null;
  const segmentFor = (labels, stopLabels = []) => {
    const startPattern = labels.map((value) => buildFlexiblePhrasePattern(value)).join("|");
    const stopPattern = stopLabels.length
      ? stopLabels.map((value) => buildFlexiblePhrasePattern(value)).join("|")
      : "$";
    const match = normalized.match(
      new RegExp(`(?:${startPattern})\\s*[:\\-]?\\s*([\\s\\S]{18,360}?)(?=\\s*(?:${stopPattern}))`, "i"),
    );
    const extracted = cleanPdfExtractedValue(match?.[1] || "");
    return extracted ? compactInsightSnippet(extracted, 240) : null;
  };

  const social = segmentFor(["Social", "SO"], ["Self-Preservation", "Self Preservation", "One-on-One", "Sexual", "SX"]);
  const selfPres = segmentFor(["Self-Preservation", "Self Preservation", "SP"], ["Social", "One-on-One", "Sexual", "SX"]);
  const oneOnOne = segmentFor(["One-on-One", "One to One", "Sexual", "SX"], ["Social", "Self-Preservation", "Self Preservation", "SP"]);
  if (!social && !selfPres && !oneOnOne) return null;
  return { social, selfPres, oneOnOne };
}

function extractBodyLanguageRowsFromText(rawText) {
  const normalized = normalizeExtractedText(rawText || "");
  if (!normalized) return [];
  const bodyBlock = normalized.match(
    /Body\s*Language[\s\S]{18,640}(?=\b(?:Listening|Giving\s*&?\s*Receiving|Feedback|Meta[-\s]?Message|$))/i,
  );
  const source = bodyBlock?.[0] || normalized;
  const bulletRows = extractBulletItemsFromText(source, 6)
    .map((row) => cleanPdfExtractedValue(row || ""))
    .filter(Boolean)
    .map((row) => compactInsightSnippet(row, 210));
  if (bulletRows.length) return Array.from(new Set(bulletRows)).slice(0, 6);

  const sentenceRows = (source.match(/[^.!?]{14,240}(?:[.!?]|$)/g) || [])
    .map((sentence) => cleanPdfExtractedValue(sentence))
    .filter((sentence) => /\b(body|posture|eye\s*contact|tone|gesture|facial|presence)\b/i.test(sentence))
    .slice(0, 6)
    .map((row) => compactInsightSnippet(row, 210));
  return Array.from(new Set(sentenceRows));
}

function extractSpreadsheetSectionFocusesFromReportContent(parsedProfile) {
  const motivationInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.motivationSummary,
    { includeStartAnchor: true },
  );
  const instinctInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.instinctGoals,
    { includeStartAnchor: true },
  );
  const developingAsInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.developingAsCopy,
    { includeStartAnchor: true },
  );
  const bodyLanguageRuleRows = extractInstructionBulletRowsFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.bodyLanguageRows,
    8,
  );
  const conflictResponseInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.responseToConflict,
    { includeStartAnchor: true },
  );
  const conflictTriggeredInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.conflictTriggersBullets,
    { includeStartAnchor: true },
  );
  const whatYouDoInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.whatYouDoWhenTriggered,
    { includeStartAnchor: true },
  );
  const centeredDecisionInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.centeredDecisions,
    { includeStartAnchor: true },
  );
  const decisionImpactInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.impactOfEnneaStyle,
    { includeStartAnchor: true },
  );
  const decisionStrainInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.overallStrainSignal,
    { includeStartAnchor: true },
  );
  const strategicLeadershipInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.strategicLeadershipCopy,
    { includeStartAnchor: true },
  );
  const teamImpactInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.teamImpactCopy,
    { includeStartAnchor: true },
  );
  const interdependenceInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.interdependenceCopy,
    { includeStartAnchor: true },
  );
  const coachingInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.coachingRelationshipCopy,
    { includeStartAnchor: true },
  );

  const coreTypeText = normalizeExtractedText([
    motivationInstructionText,
    extractSpreadsheetFocusSourceText(parsedProfile, {
      sectionMatchers: [/core/, /type/],
      pageAnchors: PDF_PAGE_ANCHORS.coreType,
    }),
  ].join(" "));
  const subtypesText = normalizeExtractedText([
    instinctInstructionText,
    extractSpreadsheetFocusSourceText(parsedProfile, {
      sectionMatchers: [/subtype/, /instinct/, /27\s*subtypes/],
      pageAnchors: PDF_PAGE_ANCHORS.subtypesInstincts,
    }),
  ].join(" "));
  const communicationText = extractSpreadsheetFocusSourceText(parsedProfile, {
    sectionMatchers: [/communication/, /feedback/],
    pageAnchors: PDF_PAGE_ANCHORS.communication,
  });
  const conflictText = normalizeExtractedText([
    conflictResponseInstructionText,
    conflictTriggeredInstructionText,
    whatYouDoInstructionText,
    extractSpreadsheetFocusSourceText(parsedProfile, {
      sectionMatchers: [/conflict/, /trigger/],
      pageAnchors: PDF_PAGE_ANCHORS.conflictTriggers,
    }),
  ].join(" "));
  const decisionText = normalizeExtractedText([
    centeredDecisionInstructionText,
    decisionImpactInstructionText,
    decisionStrainInstructionText,
    extractSpreadsheetFocusSourceText(parsedProfile, {
      sectionMatchers: [/decision/],
      pageAnchors: PDF_PAGE_ANCHORS.decisionMaking,
    }),
  ].join(" "));
  const leadershipText = normalizeExtractedText([
    strategicLeadershipInstructionText,
    extractSpreadsheetFocusSourceText(parsedProfile, {
      sectionMatchers: [/leadership/, /management/, /strategic/],
      pageAnchors: PDF_PAGE_ANCHORS.leadershipManagement,
    }),
  ].join(" "));
  const teamText = normalizeExtractedText([
    teamImpactInstructionText,
    interdependenceInstructionText,
    extractSpreadsheetFocusSourceText(parsedProfile, {
      sectionMatchers: [/team\s*behavio[u]?r/, /team\s*dynamics/, /forming/, /storming/, /norming/, /performing/],
      pageAnchors: PDF_PAGE_ANCHORS.teamBehaviour,
    }),
  ].join(" "));
  const coachingText = normalizeExtractedText([
    coachingInstructionText,
    extractSpreadsheetFocusSourceText(parsedProfile, {
      sectionMatchers: [/coaching\s*relationship/, /coaching/],
      pageAnchors: PDF_PAGE_ANCHORS.coachingRelationship,
    }),
  ].join(" "));

  const focused = {
    motivationSummary: extractSpreadsheetSnippetFromText(
      motivationInstructionText || coreTypeText,
      ["Motivation", "Key motivations", "motivated"],
    ),
    instinctGoals: extractInstinctGoalDefinitions(subtypesText),
    developingAsCopy: extractSpreadsheetSnippetFromText(
      developingAsInstructionText || subtypesText,
      ["Developing as", "Development", "growth edge", "Development Exercise"],
    ),
    bodyLanguageRows: bodyLanguageRuleRows.length
      ? bodyLanguageRuleRows
          .map((row) => compactInsightSnippet(row, 210))
          .filter(Boolean)
      : extractBodyLanguageRowsFromText(communicationText),
    conflictResponseCopy: extractSpreadsheetSnippetFromText(
      conflictResponseInstructionText || conflictText,
      ["Response to Conflict", "conflict response"],
    ),
    conflictTriggeredCopy: extractSpreadsheetSnippetFromText(
      whatYouDoInstructionText || conflictTriggeredInstructionText || conflictText,
      ["What you do when triggered", "when triggered", "triggered", "What triggers you"],
    ),
    centeredDecisionCopy: extractSpreadsheetSnippetFromText(
      centeredDecisionInstructionText || decisionText,
      ["Centered Decisions", "Decision Making", "Experience", "Intelligibility", "Commitment"],
    ),
    decisionImpactCopy: extractSpreadsheetSnippetFromText(
      decisionImpactInstructionText || decisionText,
      ["Impact of your Ennea style", "Impact of your Enneagram style", "Impact of your style"],
    ),
    decisionStrainCopy: extractSpreadsheetSnippetFromText(
      decisionStrainInstructionText || decisionText,
      ["Ben your perceived level of Overall strain", "Overall Strain", "decision strain", "Strain"],
    ),
    strategicLeadershipCopy: extractSpreadsheetSnippetFromText(
      strategicLeadershipInstructionText || leadershipText,
      ["Strategic Leadership", "Visioning", "Alignment", "Change Management"],
    ),
    teamImpactCopy: extractSpreadsheetSnippetFromText(
      teamImpactInstructionText || teamText,
      ["Your Impact on Team", "Impact on Team"],
    ),
    interdependenceCopy: extractSpreadsheetSnippetFromText(
      interdependenceInstructionText || teamText,
      ["Interdependence and Team Role", "Intedependence and Team Role", "Interdependence", "Team Role"],
    ),
    coachingRelationshipCopy: extractSpreadsheetSnippetFromText(
      coachingInstructionText || coachingText,
      ["Ben, as an Ennea", "Coaching Relationship", "coaching relationship"],
    ),
  };
  if (!focused.instinctGoals) {
    focused.instinctGoals = extractInstinctGoalDefinitions(
      normalizeExtractedText(`${instinctInstructionText || ""} ${subtypesText || ""}`),
    );
  }
  console.log("[spreadsheet-focus] extracted structured section focuses", {
    hasMotivation: Boolean(focused.motivationSummary),
    hasInstinctGoals: Boolean(focused.instinctGoals),
    bodyLanguageRows: focused.bodyLanguageRows.length,
    hasConflictResponse: Boolean(focused.conflictResponseCopy),
    hasCenteredDecision: Boolean(focused.centeredDecisionCopy),
    hasStrategicLeadership: Boolean(focused.strategicLeadershipCopy),
    hasTeamImpact: Boolean(focused.teamImpactCopy),
    hasCoachingRelationship: Boolean(focused.coachingRelationshipCopy),
    usedInstructionRules: true,
  });
  return focused;
}

function extractSpreadsheetSectionFocusesFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText || "");
  if (!normalized) return {};
  const focused = {
    motivationSummary: extractSpreadsheetSnippetFromText(normalized, ["Motivation", "Key motivations", "motivated"]),
    instinctGoals: extractInstinctGoalDefinitions(normalized),
    developingAsCopy: extractSpreadsheetSnippetFromText(normalized, ["Developing as", "Development", "growth edge"]),
    bodyLanguageRows: extractBodyLanguageRowsFromText(normalized),
    conflictResponseCopy: extractSpreadsheetSnippetFromText(normalized, ["Response to Conflict", "conflict response"]),
    conflictTriggeredCopy: extractSpreadsheetSnippetFromText(normalized, ["What you do when triggered", "when triggered", "triggered"]),
    centeredDecisionCopy: extractSpreadsheetSnippetFromText(normalized, ["Centered Decisions", "centered decisions"]),
    decisionImpactCopy: extractSpreadsheetSnippetFromText(normalized, ["Impact of your Ennea style", "Impact of your Enneagram style", "Impact of your style"]),
    decisionStrainCopy: extractSpreadsheetSnippetFromText(normalized, ["Level strain", "decision strain", "Strain"]),
    strategicLeadershipCopy: extractSpreadsheetSnippetFromText(normalized, ["Strategic Leadership", "Visioning", "Alignment", "Change Management"]),
    teamImpactCopy: extractSpreadsheetSnippetFromText(normalized, ["Your Impact on Team", "Impact on Team"]),
    interdependenceCopy: extractSpreadsheetSnippetFromText(normalized, ["Interdependence and Team Role", "Intedependence and Team Role", "Interdependence", "Team Role"]),
    coachingRelationshipCopy: extractSpreadsheetSnippetFromText(normalized, ["Coaching Relationship", "coaching relationship"]),
  };
  console.log("[spreadsheet-focus] extracted PDF-text section focuses", {
    hasMotivation: Boolean(focused.motivationSummary),
    hasInstinctGoals: Boolean(focused.instinctGoals),
    bodyLanguageRows: focused.bodyLanguageRows.length,
    hasConflictResponse: Boolean(focused.conflictResponseCopy),
    hasCenteredDecision: Boolean(focused.centeredDecisionCopy),
    hasStrategicLeadership: Boolean(focused.strategicLeadershipCopy),
    hasTeamImpact: Boolean(focused.teamImpactCopy),
    hasCoachingRelationship: Boolean(focused.coachingRelationshipCopy),
  });
  return focused;
}

function mergeSpreadsheetSectionFocuses(structuredFocuses, pdfFocuses) {
  const structured = structuredFocuses && typeof structuredFocuses === "object" ? structuredFocuses : {};
  const pdf = pdfFocuses && typeof pdfFocuses === "object" ? pdfFocuses : {};
  const fallback = "Not detected in assigned PDF.";
  const mergeGoal = (key) => firstPresentSnippet([structured?.instinctGoals?.[key], pdf?.instinctGoals?.[key]], fallback);
  const mergedBodyRows = [...(Array.isArray(structured.bodyLanguageRows) ? structured.bodyLanguageRows : []), ...(Array.isArray(pdf.bodyLanguageRows) ? pdf.bodyLanguageRows : [])]
    .map((row) => cleanPdfExtractedValue(row || ""))
    .filter(Boolean)
    .filter((row) => !isMissingExtractedText(row))
    .slice(0, 6);
  return {
    motivationSummary: firstPresentSnippet([structured.motivationSummary, pdf.motivationSummary], fallback),
    instinctGoals: {
      selfPres: mergeGoal("selfPres"),
      social: mergeGoal("social"),
      oneOnOne: mergeGoal("oneOnOne"),
    },
    developingAsCopy: firstPresentSnippet([structured.developingAsCopy, pdf.developingAsCopy], fallback),
    bodyLanguageRows: mergedBodyRows.length ? mergedBodyRows : [fallback],
    conflictResponseCopy: firstPresentSnippet([structured.conflictResponseCopy, pdf.conflictResponseCopy], fallback),
    conflictTriggeredCopy: firstPresentSnippet([structured.conflictTriggeredCopy, pdf.conflictTriggeredCopy], fallback),
    centeredDecisionCopy: firstPresentSnippet([structured.centeredDecisionCopy, pdf.centeredDecisionCopy], fallback),
    decisionImpactCopy: firstPresentSnippet([structured.decisionImpactCopy, pdf.decisionImpactCopy], fallback),
    decisionStrainCopy: firstPresentSnippet([structured.decisionStrainCopy, pdf.decisionStrainCopy], fallback),
    strategicLeadershipCopy: firstPresentSnippet([structured.strategicLeadershipCopy, pdf.strategicLeadershipCopy], fallback),
    teamImpactCopy: firstPresentSnippet([structured.teamImpactCopy, pdf.teamImpactCopy], fallback),
    interdependenceCopy: firstPresentSnippet([structured.interdependenceCopy, pdf.interdependenceCopy], fallback),
    coachingRelationshipCopy: firstPresentSnippet([structured.coachingRelationshipCopy, pdf.coachingRelationshipCopy], fallback),
  };
}

function extractStrainQualitativeFromReportContent(parsedProfile) {
  const strainSection = getSectionByTitle(parsedProfile, (title) => /strain/i.test(title));
  const text = normalizeExtractedText(
    [
      getSectionCompositeText(parsedProfile, strainSection),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.strainProfile.overall),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.strainProfile.vocational),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.strainProfile.environmental),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.strainProfile.physical),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.strainProfile.interpersonal),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.strainProfile.psychological),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.strainProfile.happiness),
    ].join(" "),
  );
  const categories = ["Happiness", "Vocational", "Interpersonal", "Physical", "Environmental", "Psychological"];
  const ruleByCategory = {
    happiness: ASSIGNED_PDF_INSTRUCTION_RULES.happinessStrain,
    vocational: ASSIGNED_PDF_INSTRUCTION_RULES.vocationalStrain,
    interpersonal: ASSIGNED_PDF_INSTRUCTION_RULES.interpersonalStrain,
    physical: ASSIGNED_PDF_INSTRUCTION_RULES.physicalStrain,
    environmental: ASSIGNED_PDF_INSTRUCTION_RULES.environmentalStrain,
    psychological: ASSIGNED_PDF_INSTRUCTION_RULES.psychologicalStrain,
  };

  if (!text) {
    return categories.map((category) => ({ category, text: "Not detected in structured report content." }));
  }

  return categories.map((category, index) => {
    const categoryKey = String(category || "").toLowerCase();
    const ruleText = extractInstructionTextFromReportContent(
      parsedProfile,
      ruleByCategory[categoryKey],
      { includeStartAnchor: true },
    );
    if (ruleText) {
      const levelMatch = String(ruleText).match(/perceived\s+level\s+of\s+[^.]{0,80}strain\s+is\s+(LOW|MEDIUM|HIGH|MODERATE)/i);
      const level = String(levelMatch?.[1] || "").toUpperCase();
      const bulletRows = extractBulletItemsFromText(ruleText, 6);
      const explicitNarrative = level && bulletRows.length
        ? cleanPdfExtractedValue(`${category} strain is ${level}. ${bulletRows.map((row) => `• ${row}`).join(" ")}`)
        : cleanPdfExtractedValue(ruleText);
      if (explicitNarrative && !isLowQualityStrainNarrative(explicitNarrative, category)) {
        return {
          category,
          text: explicitNarrative,
        };
      }
    }

    const bulletNarrative = extractBulletStrainNarrative({
      text,
      category,
      nextCategories: categories.slice(index + 1),
    });
    if (bulletNarrative && !isLowQualityStrainNarrative(bulletNarrative, category)) {
      return {
        category,
        text: bulletNarrative,
      };
    }

    const levelWithNarrative = text.match(
      new RegExp(
        `${escapeRegex(category)}\\s+strain\\s+is\\s+(LOW|MEDIUM|HIGH|MODERATE)\\.?\\s*([\\s\\S]{18,520}?)(?=\\s*(?:${categories
          .slice(index + 1)
          .map((value) => `${escapeRegex(value)}\\s+strain\\s+is`)
          .join("|") || "overall\\s+strain\\s+level|$"}))`,
        "i",
      ),
    );
    if (levelWithNarrative?.[1]) {
      const level = String(levelWithNarrative[1] || "").toUpperCase();
      const detail = cleanPdfExtractedValue(levelWithNarrative[2] || "");
      const combined = cleanPdfExtractedValue(`${category} strain is ${level}. ${detail || ""}`);
      if (combined && !isLowQualityStrainNarrative(combined, category)) {
        return {
          category,
          text: combined,
        };
      }
    }

    const nextLabels = categories.slice(index + 1);
    const nextBoundary = nextLabels.length ? `(?:${nextLabels.map(escapeRegex).join("|")})\\b` : "$";
    const pattern = new RegExp(`${escapeRegex(category)}\\s*[:\\-]?\\s*([\\s\\S]{10,280}?)(?=\\s*${nextBoundary})`, "i");
    const match = text.match(pattern);
    const snippet = cleanPdfExtractedValue(match?.[1] || "") || extractSnippetFromLabels(text, [category, `${category} Strain`]);
    if (snippet && !isLowQualityStrainNarrative(snippet, category)) {
      return {
        category,
        text: snippet,
      };
    }

    return {
      category,
      text: "Not detected in structured report content.",
    };
  });
}

function extractDevelopmentExercisesFromReportContent(parsedProfile) {
  const structuredBlockExercises = splitDevelopmentExercisesTextBlock(
    parsedProfile?.reportContent?.developmentExercisesText,
  );
  if (structuredBlockExercises.length) {
    return structuredBlockExercises;
  }

  const instructionExercises = splitDevelopmentExercisesTextBlock(
    extractInstructionTextFromReportContent(
      parsedProfile,
      ASSIGNED_PDF_INSTRUCTION_RULES.developmentExercises,
      { includeStartAnchor: true },
    ),
  );
  if (instructionExercises.length) {
    return instructionExercises;
  }

  const devSection = getSectionByTitle(parsedProfile, (title) => /development/i.test(title));
  const text = normalizeExtractedText(
    [
      getSectionCompositeText(parsedProfile, devSection),
      getPageAnchoredText(parsedProfile, PDF_PAGE_ANCHORS.developmentExercises),
    ].join(" "),
  );
  const matches = [];
  if (text) {
    const pattern = /DEVELOPMENT\s*EXERCISE\s*[:\-]?\s*([\s\S]{16,420}?)(?=DEVELOPMENT\s*EXERCISE|Key\s*Challenges|$)/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const cleaned = cleanPdfExtractedValue(match?.[1] || "");
      if (!cleaned || isLikelyGarbledDevelopmentExerciseText(cleaned)) continue;
      matches.push(cleaned);
      if (matches.length >= 8) break;
    }
  }
  if (!matches.length) {
    const pages = getReportContentPages(parsedProfile);
    const desiredDevPages = new Set(PDF_PAGE_ANCHORS.developmentExercises.map((n) => Number(n)));
    const fallback = pages
      .filter((page) => desiredDevPages.has(Number(page?.pageNumber)) || /development/i.test(String(page?.heading || "")))
      .flatMap((page) => (Array.isArray(page?.keyDataPoints) ? page.keyDataPoints : []))
      .map((line) => cleanPdfExtractedValue(line))
      .filter((line) => line && !isLikelyGarbledDevelopmentExerciseText(line))
      .slice(0, 8);
    matches.push(...fallback);
  }
  const dedupedMatches = Array.from(new Set(matches));
  if (!dedupedMatches.length) {
    return [
      { title: "Exercise 1", text: "Not detected in structured report content." },
      { title: "Exercise 2", text: "Not detected in structured report content." },
      { title: "Exercise 3", text: "Not detected in structured report content." },
    ];
  }
  return dedupedMatches.map((item, index) => ({ title: `Exercise ${index + 1}`, text: item }));
}

function buildDataQualityDiagnostics({ parsedProfile, parseDiagnostics, feedbackGuideMatrix, strainQualitativeWriteups, developmentExercises }) {
  const issues = [];
  const typeScores = parsedProfile?.typeScores || {};
  const instinctScores = parsedProfile?.instinctScores || {};
  const centerScores = parsedProfile?.centerScores || {};
  const typeValues = Object.values(typeScores).map(Number).filter((v) => Number.isFinite(v));
  const instinctValues = Object.values(instinctScores).map(Number).filter((v) => Number.isFinite(v));
  const centerValues = Object.values(centerScores).map(Number).filter((v) => Number.isFinite(v));
  const typeNonZero = typeValues.filter((v) => v > 0).length;
  const sectionCount = getReportContentSections(parsedProfile).length;

  if (!typeValues.length || typeNonZero < 3) {
    issues.push("Type score chart data appears low-quality (few/no non-zero values).");
  }
  if (!instinctValues.length || instinctValues.filter((v) => v > 0).length < 1) {
    issues.push("Instinct score values are mostly missing.");
  }
  if (!centerValues.length || centerValues.filter((v) => v > 0).length < 2) {
    issues.push("Center score values are sparse (likely partial extraction).");
  }
  if (sectionCount < 8) {
    issues.push(`Only ${sectionCount} structured sections available; expected broader PRO coverage.`);
  }
  if (!Array.isArray(feedbackGuideMatrix) || feedbackGuideMatrix.every((row) => /Not detected/i.test(String(row?.guidance || "")))) {
    issues.push("Feedback guide matrix content not found in structured report content.");
  }
  if (!Array.isArray(strainQualitativeWriteups) || strainQualitativeWriteups.every((row) => /Not detected/i.test(String(row?.text || "")))) {
    issues.push("Qualitative strain narratives not found in structured report content.");
  }
  if (!Array.isArray(developmentExercises) || developmentExercises.every((row) => /Not detected/i.test(String(row?.text || "")))) {
    issues.push("Development exercises not found in structured report content.");
  }

  const formatParserEvent = (entry, fallbackLabel) => {
    if (!entry) return null;
    if (typeof entry === "string") return `${fallbackLabel}: ${entry}`;
    const message = String(entry?.message || fallbackLabel);
    const details = entry?.details == null ? "" : ` (${String(entry.details)})`;
    return `${fallbackLabel}: ${message}${details}`;
  };

  const parserWarnings = Array.isArray(parseDiagnostics?.warnings) ? parseDiagnostics.warnings : [];
  const parserErrors = Array.isArray(parseDiagnostics?.errors) ? parseDiagnostics.errors : [];
  parserWarnings.forEach((warning) => {
    const formatted = formatParserEvent(warning, "Parser warning");
    if (formatted) issues.push(formatted);
  });
  parserErrors.forEach((error) => {
    const formatted = formatParserEvent(error, "Parser error");
    if (formatted) issues.push(formatted);
  });

  const pages = Number(parseDiagnostics?.extraction?.pages || 0);
  const detectedTotalPages = Number(parseDiagnostics?.extraction?.detectedTotalPages || 0);
  const minExpectedPages = Number(parseDiagnostics?.extraction?.minExpectedPages || 0);
  const sections = Number(parseDiagnostics?.extraction?.sections || 0);
  const typeScoresPopulated = Number.isFinite(Number(parseDiagnostics?.scoreCoverage?.typeScoresNonNull))
    ? Number(parseDiagnostics.scoreCoverage.typeScoresNonNull)
    : Object.values(typeScores).filter((value) => value != null && Number.isFinite(Number(value))).length;
  const typeScoresTotal = Number.isFinite(Number(parseDiagnostics?.scoreCoverage?.typeScoresTotal))
    ? Number(parseDiagnostics.scoreCoverage.typeScoresTotal)
    : 9;

  if (detectedTotalPages > 0 && pages < detectedTotalPages) {
    issues.push(`Page extraction mismatch: extracted ${pages} pages, detected ${detectedTotalPages} pages.`);
  }
  if (typeScoresPopulated < typeScoresTotal) {
    issues.push(`Type score coverage incomplete: ${typeScoresPopulated}/${typeScoresTotal} populated.`);
  }

  const summary = [
    `Parser status: ${parseDiagnostics?.isComplete ? "complete" : "incomplete"}`,
    `Extracted pages: ${pages}`,
    `Detected pages: ${detectedTotalPages > 0 ? detectedTotalPages : "not available"}`,
    `Expected minimum pages: ${minExpectedPages > 0 ? minExpectedPages : "not set"}`,
    `Sections: ${sections}`,
    `Type scores populated: ${typeScoresPopulated}/${typeScoresTotal}`,
  ].join(" · ");

  return {
    summary,
    issues,
    verification: {
      extractedPages: pages,
      detectedTotalPages: detectedTotalPages > 0 ? detectedTotalPages : null,
      minExpectedPages: minExpectedPages > 0 ? minExpectedPages : null,
      sections,
      typeScoresPopulated,
      typeScoresTotal,
    },
  };
}

function buildReflectionDeck(report) {
  return {
    leadership: [
      `As a Type ${report.typeNumber}, your leadership edge is balancing your ${report.typeName.toLowerCase()} strengths with deliberate pacing and inclusion.`,
      `In your next high-stakes meeting, pair your Type ${report.typeNumber} strengths with one explicit check-in question before deciding.`
    ],
    relationships: [
      `Your ${report.instinct} pattern is likely to shape how quickly you seek closeness and trust. Notice whether that pace works for others.`,
      `Today, practice communicating your need directly instead of expecting people to infer it from your style.`
    ],
    regulation: [
      `When pressure rises, your Type ${report.typeNumber} strategy can overfire. Pause, name the signal in your body, and choose your response.`,
      `A 90-second reset can prevent a full reactivity cycle and preserve connection.`
    ],
    growth: [
      `Your growth work includes lessons from ${formatTypeLine(report.release)} while staying conscious of pressure patterns connected with ${formatTypeLine(report.stretch)}.`,
      `Pick one small behavior this week that reflects your high-integration Type ${report.typeNumber} self.`
    ],
    wellbeing: [
      `Your system works best when recovery is planned, not optional. Add one non-negotiable reset block to your calendar.`,
      `Sustainable performance for Type ${report.typeNumber} means rhythm: effort, pause, reflect, then re-engage.`
    ]
  };
}

function updateCharts() {
  renderProfileWheel();
}

function applyReport(typeId) {
  try {
    const normalizedTypeId = String(typeId || "").trim();
    console.log("[report-switch] applyReport requested", normalizedTypeId);
    REPORT = normalizeReportPoints({
      ...(REPORT_EXAMPLES[normalizedTypeId] || REPORT_EXAMPLES['8']),
    });
    lastAppliedExampleType = String(REPORT.typeNumber || "8");
    reflectionDeck = buildReflectionDeck(REPORT);
    console.log('[report-switch] applying', REPORT.typeNumber, REPORT.typeName);
    renderReportFromState(true);
  } catch (error) {
    console.log('[report-switch] failed', error);
  }
}

function buildPdfOnlyProfile(typeNumber, extractedScores) {
  const order = ["8", "9", "1", "2", "3", "4", "5", "6", "7"];
  const fallback = order.map(() => 40);
  const hasExtractedScores =
    extractedScores &&
    order.filter((type) => {
      const score = toFiniteScoreOrNull(extractedScores[type]);
      return Number.isFinite(score) && score > 0;
    }).length >= 3;
  if (hasExtractedScores) {
    return order.map((type) => {
      const value = toFiniteScoreOrNull(extractedScores[type]);
      if (!Number.isFinite(value) || value < 0 || value > 100) return 40;
      return value;
    });
  }
  const idx = order.indexOf(String(typeNumber || ""));
  if (idx >= 0) fallback[idx] = 78;
  return fallback;
}

function buildPdfOnlyReport(payload) {
  const fallbackText = "Not detected in assigned PDF.";
  const typeNumber = String(payload?.typeNumber || "").match(/^[1-9]$/)?.[0] || "?";
  const typeName = sanitizeSnippet(payload?.typeName, fallbackText);
  const instinct = sanitizeSnippet(payload?.instinct, fallbackText);
  const keyword = sanitizeSnippet(payload?.subtypeKeyword, fallbackText);
  let release = formatTypeLine(sanitizeSnippet(payload?.connectedLineA, "Type ?"));
  let stretch = formatTypeLine(sanitizeSnippet(payload?.connectedLineB, "Type ?"));
  const canonicalPoints = CANONICAL_POINTS_BY_TYPE[typeNumber];
  if (canonicalPoints) {
    release = formatTypeLine(canonicalPoints.release);
    stretch = formatTypeLine(canonicalPoints.stretch);
  }
  const integration = sanitizeSnippet(payload?.integrationLevel, fallbackText);
  const profile = buildPdfOnlyProfile(typeNumber, payload?.profileScores);
  const strainScoresRaw = getParsedProfileStrainScores({ strainScores: payload?.strainScoresRaw });
  const strain = strainScoresRaw
    ? [
        toFiniteScoreOrNull(strainScoresRaw.happiness),
        toFiniteScoreOrNull(strainScoresRaw.vocational),
        toFiniteScoreOrNull(strainScoresRaw.interpersonal),
        toFiniteScoreOrNull(strainScoresRaw.physical),
        toFiniteScoreOrNull(strainScoresRaw.environmental),
        toFiniteScoreOrNull(strainScoresRaw.psychological),
      ]
    : [null, null, null, null, null, null];
  const releaseType = getLineTypeNumber(release);
  const stretchType = getLineTypeNumber(stretch);
  const releaseIndex = PROFILE_TYPE_ORDER.indexOf(releaseType);
  const stretchIndex = PROFILE_TYPE_ORDER.indexOf(stretchType);
  const mainIndex = PROFILE_TYPE_ORDER.indexOf(typeNumber);
  const parsedCorePatternLines = Array.isArray(payload?.corePatternLines)
    ? payload.corePatternLines
        .map((line) => sanitizeSnippet(line, null))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const deepLines = (parsedCorePatternLines.length
    ? parsedCorePatternLines
    : [
        `Type: ${typeNumber} — ${typeName}`,
        `Dominant instinct: ${instinct}`,
        `Release point: ${release}`,
        `Stretch point: ${stretch}`,
      ]).slice(0, 4);
  while (deepLines.length < 4) deepLines.push(fallbackText);

  return {
    typeNumber,
    typeName,
    instinct,
    keyword,
    release,
    stretch,
    integration,
    coreFear: sanitizeSnippet(payload?.basicFear, fallbackText),
    gifts: sanitizeSnippet(payload?.basicDesire, fallbackText),
    giftsDesc: "",
    vice: sanitizeSnippet(payload?.passion, fallbackText),
    viceDesc: "",
    worldview: sanitizeSnippet(payload?.worldview, fallbackText),
    focus: sanitizeSnippet(payload?.focus, fallbackText),
    selfTalk: sanitizeSnippet(payload?.metaQuote, fallbackText),
    traits: [],
    deepTitle: sanitizeSnippet(payload?.corePatternTitle, null) || `Type ${typeNumber} Core Pattern`,
    deep: deepLines,
    meta: sanitizeSnippet(payload?.metaQuote, fallbackText),
    clientName: sanitizeSnippet(payload?.clientName, "Not detected"),
    reportDate: sanitizeSnippet(payload?.reportDate, "Not detected"),
    wing: sanitizeSnippet(payload?.wing, "Not detected"),
    trifix: sanitizeSnippet(payload?.trifix, "Not detected"),
    levelOfDevelopment: sanitizeSnippet(payload?.levelOfDevelopment, "Not detected"),
    centreOfIntelligence: sanitizeSnippet(payload?.centreOfIntelligence, "Not detected"),
    typeScoresRaw: payload?.typeScoresRaw || null,
    instinctScoresRaw: payload?.instinctScoresRaw || null,
    centerScoresRaw: payload?.centerScoresRaw || null,
    strainScoresRaw,
    interactionScores: payload?.interactionScores || null,
    extractedPageCount: Number(payload?.extractedPageCount || 0),
    extractedSectionCount: Number(payload?.extractedSectionCount || 0),
    extractedSectionTitles: Array.isArray(payload?.extractedSectionTitles) ? payload.extractedSectionTitles : [],
    insightTeamDynamics: sanitizeSnippet(payload?.insightTeamDynamics, "Not detected in parsed PDF text."),
    insightDecisionFramework: sanitizeSnippet(payload?.insightDecisionFramework, "Not detected in parsed PDF text."),
    insightStrategicLeadership: sanitizeSnippet(payload?.insightStrategicLeadership, "Not detected in parsed PDF text."),
    insightCoachingRelationship: sanitizeSnippet(payload?.insightCoachingRelationship, "Not detected in parsed PDF text."),
    insightFeedbackGuide: sanitizeSnippet(payload?.insightFeedbackGuide, "Not detected in parsed PDF text."),
    insightComposite: sanitizeSnippet(payload?.insightComposite, "Not detected in parsed PDF text."),
    feedbackGuideMatrix: Array.isArray(payload?.feedbackGuideMatrix) ? payload.feedbackGuideMatrix : [],
    strainQualitativeWriteups: Array.isArray(payload?.strainQualitativeWriteups) ? payload.strainQualitativeWriteups : [],
    overallStrainSummary: sanitizeSnippet(payload?.overallStrainSummary, null),
    developmentExercises: Array.isArray(payload?.developmentExercises) ? payload.developmentExercises : [],
    spreadsheetFocuses: payload?.spreadsheetFocuses && typeof payload.spreadsheetFocuses === "object"
      ? {
          motivationSummary: sanitizeSnippet(payload.spreadsheetFocuses.motivationSummary, "Not detected in assigned PDF."),
          instinctGoals: {
            selfPres: sanitizeSnippet(payload?.spreadsheetFocuses?.instinctGoals?.selfPres, "Not detected in assigned PDF."),
            social: sanitizeSnippet(payload?.spreadsheetFocuses?.instinctGoals?.social, "Not detected in assigned PDF."),
            oneOnOne: sanitizeSnippet(payload?.spreadsheetFocuses?.instinctGoals?.oneOnOne, "Not detected in assigned PDF."),
          },
          developingAsCopy: sanitizeSnippet(payload.spreadsheetFocuses.developingAsCopy, "Not detected in assigned PDF."),
          bodyLanguageRows: Array.isArray(payload.spreadsheetFocuses.bodyLanguageRows)
            ? payload.spreadsheetFocuses.bodyLanguageRows
                .map((row) => sanitizeSnippet(row, null))
                .filter(Boolean)
            : [],
          conflictResponseCopy: sanitizeSnippet(payload.spreadsheetFocuses.conflictResponseCopy, "Not detected in assigned PDF."),
          conflictTriggeredCopy: sanitizeSnippet(payload.spreadsheetFocuses.conflictTriggeredCopy, "Not detected in assigned PDF."),
          centeredDecisionCopy: sanitizeSnippet(payload.spreadsheetFocuses.centeredDecisionCopy, "Not detected in assigned PDF."),
          decisionImpactCopy: sanitizeSnippet(payload.spreadsheetFocuses.decisionImpactCopy, "Not detected in assigned PDF."),
          decisionStrainCopy: sanitizeSnippet(payload.spreadsheetFocuses.decisionStrainCopy, "Not detected in assigned PDF."),
          strategicLeadershipCopy: sanitizeSnippet(payload.spreadsheetFocuses.strategicLeadershipCopy, "Not detected in assigned PDF."),
          teamImpactCopy: sanitizeSnippet(payload.spreadsheetFocuses.teamImpactCopy, "Not detected in assigned PDF."),
          interdependenceCopy: sanitizeSnippet(payload.spreadsheetFocuses.interdependenceCopy, "Not detected in assigned PDF."),
          coachingRelationshipCopy: sanitizeSnippet(payload.spreadsheetFocuses.coachingRelationshipCopy, "Not detected in assigned PDF."),
        }
      : null,
    teamStageBreakdown: payload?.teamStageBreakdown && typeof payload.teamStageBreakdown === "object"
      ? {
          forming: sanitizeSnippet(payload.teamStageBreakdown.forming, "Not detected in assigned PDF."),
          storming: sanitizeSnippet(payload.teamStageBreakdown.storming, "Not detected in assigned PDF."),
          norming: sanitizeSnippet(payload.teamStageBreakdown.norming, "Not detected in assigned PDF."),
          performing: sanitizeSnippet(payload.teamStageBreakdown.performing, "Not detected in assigned PDF."),
        }
      : null,
    dataQualityDiagnostics: payload?.dataQualityDiagnostics || null,
    profile,
    strain,
    mainValue: mainIndex >= 0 ? profile[mainIndex] : 0,
    releaseValue: releaseIndex >= 0 ? profile[releaseIndex] : 0,
    stretchValue: stretchIndex >= 0 ? profile[stretchIndex] : 0,
  };
}

function buildGrowthCopyForDisplay(report) {
  const typeNumber = String(report?.typeNumber || "?");
  const stretch = formatTypeLine(report?.stretch || "Type ?");
  const release = formatTypeLine(report?.release || "Type ?");
  return {
    stretchTitle: `Stretch Point — ${stretch}`,
    stretchBody: `Stretch Point links Type ${typeNumber} with ${stretch} themes that support growth through new perspectives and behaviors.`,
    stretchFollowup: `Integrating strengths from ${stretch} helps balance your default pattern and expands your range under pressure.`,
    stretchQuote: `Stretch through intentional practice of ${stretch} qualities.`,
    releaseTitle: `Release Point — ${release}`,
    releaseBody: `Release Point links Type ${typeNumber} with ${release} themes that help you regulate strain and restore clarity.`,
    releaseIbox: `Returning to ${release} strengths can reduce reactivity and support steadier decision making.`,
  };
}

function renderReportFromState(isExampleMode) {
  const missingAssignedPdfText = "Not detected in assigned PDF.";
  setText('typeBadge', REPORT.typeNumber);
  setText('headerSubtitle', `Type ${REPORT.typeNumber} · ${REPORT.instinct}`);
  setText('reportTitle', isExampleMode ? `Type ${REPORT.typeNumber} Example Report` : `Type ${REPORT.typeNumber} Assigned PDF Report`);
  setText('mainTypeValue', currentCoreTypeLabel());
  setText('instinctValue', REPORT.instinct);
  setText('keywordValue', REPORT.keyword);
  const growthCopy = buildGrowthCopyForDisplay(REPORT);
  setText('growthStretchTitle', growthCopy.stretchTitle);
  setText('growthStretchBody', growthCopy.stretchBody);
  setText('growthStretchFollowup', growthCopy.stretchFollowup);
  setText('growthStretchQuote', growthCopy.stretchQuote);
  setText('growthReleaseTitle', growthCopy.releaseTitle);
  setText('growthReleaseBody', growthCopy.releaseBody);
  setText('growthReleaseIbox', growthCopy.releaseIbox);
  setText('profileWheelBadgeType', REPORT.typeNumber);
  setText('profileWheelBadgeKeyword', String(REPORT.keyword || '').toUpperCase());
  setText('profileWheelBadgeInstinct', String(REPORT.instinct || '').split('—')[0].trim() || 'N/A');
  // Render the wheel early so My Report still shows the graphic even if later blocks throw.
  try {
    renderProfileWheel();
  } catch (error) {
    console.log('[profile-wheel] early render failed', error);
  }
  setText('releaseValue', formatTypeLine(REPORT.release));
  setText('stretchValue', formatTypeLine(REPORT.stretch));
  const normalizedIntegrationLevel = normalizeIntegrationLevel(REPORT.integration);
  setText('integrationValue', normalizedIntegrationLevel);
  renderIntegrationPanel(normalizedIntegrationLevel);
  setText('metaQuote', `"${REPORT.meta}"`);
  const coreFearValue = String(REPORT.coreFear || '').replace(/^basic\s*fear\s*:\s*/i, '').trim() || REPORT.coreFear;
  const coreFearDisplay = coreFearValue
    ? `${String(coreFearValue).charAt(0).toUpperCase()}${String(coreFearValue).slice(1)}`
    : coreFearValue;
  setText('coreFearValue', coreFearDisplay);
  setText('giftsValue', REPORT.gifts);
  const viceCombined = [REPORT.vice, REPORT.viceDesc].filter((part) => String(part || '').trim()).join(' ');
  setText('vicesValue', viceCombined);
  setText('clientNameValue', formatOptionalText(REPORT.clientName, 'Not detected'));
  setText('reportDateValue', formatOptionalText(REPORT.reportDate, 'Not detected'));
  setText('wingValue', formatOptionalText(REPORT.wing, 'Not detected'));
  setText('trifixValue', formatOptionalText(REPORT.trifix, 'Not detected'));
  setText('developmentLevelValue', formatOptionalText(REPORT.levelOfDevelopment, 'Not detected'));
  setText('centerOfIntelligenceValue', formatOptionalText(REPORT.centreOfIntelligence, 'Not detected'));
  setText('typeScoresValue', `Type scores: ${formatScoreObject({
    type1: '1', type2: '2', type3: '3', type4: '4', type5: '5', type6: '6', type7: '7', type8: '8', type9: '9'
  }, REPORT.typeScoresRaw)}`);
  setText('instinctScoresValue', `Instinct scores: ${formatScoreObject({
    sexual: 'SX',
    social: 'SO',
    selfPreservation: 'SP'
  }, REPORT.instinctScoresRaw)}`);
  setText('centerScoresValue', `Center scores: ${formatScoreObject({
    body: 'Body',
    heart: 'Heart',
    head: 'Head'
  }, REPORT.centerScoresRaw)}`);
  setText('extractedCountsValue', `Pages: ${Number(REPORT.extractedPageCount || 0)} · Sections: ${Number(REPORT.extractedSectionCount || 0)}`);
  const diagnosticsSnapshot = REPORT.dataQualityDiagnostics?.verification || null;
  const detectedPages = Number(diagnosticsSnapshot?.detectedTotalPages || 0);
  const typeScoresPopulated = Number.isFinite(Number(diagnosticsSnapshot?.typeScoresPopulated))
    ? Number(diagnosticsSnapshot.typeScoresPopulated)
    : Object.values(REPORT.typeScoresRaw || {}).filter((value) => value != null && Number.isFinite(Number(value))).length;
  const typeScoresTotal = Number.isFinite(Number(diagnosticsSnapshot?.typeScoresTotal))
    ? Number(diagnosticsSnapshot.typeScoresTotal)
    : 9;
  setText(
    'extractedVerificationValue',
    `Detected pages: ${detectedPages > 0 ? detectedPages : "Not available"} · Type scores populated: ${typeScoresPopulated}/${typeScoresTotal}`,
  );
  const sectionTags = Array.isArray(REPORT.extractedSectionTitles)
    ? REPORT.extractedSectionTitles.filter(Boolean).slice(0, 10)
    : [];
  setHtml(
    'extractedSectionsList',
    sectionTags.length
      ? sectionTags.map((title) => `<span class="chip cgn">${title}</span>`).join('')
      : '<span class="chip cgn">No parsed sections available</span>',
  );
  setText('insightTeamDynamics', formatOptionalText(REPORT.insightTeamDynamics, 'Not detected in parsed PDF text.'));
  setText('insightDecisionFramework', formatOptionalText(REPORT.insightDecisionFramework, 'Not detected in parsed PDF text.'));
  setText('insightStrategicLeadership', formatOptionalText(REPORT.insightStrategicLeadership, 'Not detected in parsed PDF text.'));
  setText('insightCoachingRelationship', formatOptionalText(REPORT.insightCoachingRelationship, 'Not detected in parsed PDF text.'));
  setText('insightFeedbackGuide', formatOptionalText(REPORT.insightFeedbackGuide, 'Not detected in parsed PDF text.'));
  setText('insightComposite', formatOptionalText(REPORT.insightComposite, 'Not detected in parsed PDF text.'));

  const feedbackRows = Array.isArray(REPORT.feedbackGuideMatrix) && REPORT.feedbackGuideMatrix.length
    ? REPORT.feedbackGuideMatrix
    : Array.from({ length: 9 }, (_, idx) => ({
        type: `Type ${idx + 1}`,
        label: "",
        guidance: "Not detected in assigned PDF.",
      }));
  setHtml(
    'feedbackGuideMatrixBody',
    feedbackRows
      .map(
        (row, idx) => `<tr>
  <td style="padding:8px;${idx < feedbackRows.length - 1 ? "border-bottom:1px solid var(--border2);" : ""}"><strong>${row.type}</strong>${row.label ? ` · ${row.label}` : ""}</td>
  <td style="padding:8px;${idx < feedbackRows.length - 1 ? "border-bottom:1px solid var(--border2);" : ""}">${renderFeedbackGuidanceCell(formatOptionalText(row.guidance, "Not detected in assigned PDF."))}</td>
</tr>`,
      )
      .join(""),
  );

  const strainNarratives = Array.isArray(REPORT.strainQualitativeWriteups) && REPORT.strainQualitativeWriteups.length
    ? REPORT.strainQualitativeWriteups
    : [
        "Happiness",
        "Vocational",
        "Interpersonal",
        "Physical",
        "Environmental",
        "Psychological",
      ].map((category) => ({ category, text: "Not detected in assigned PDF." }));

  const exercises = Array.isArray(REPORT.developmentExercises) && REPORT.developmentExercises.length
    ? REPORT.developmentExercises
    : [
        { title: "Exercise 1", text: "Not detected in assigned PDF." },
        { title: "Exercise 2", text: "Not detected in assigned PDF." },
        { title: "Exercise 3", text: "Not detected in assigned PDF." },
      ];
  setHtml(
    'developmentExercisesList',
    exercises
      .map(
        (exercise) =>
          `<div class="dev-item"><div class="dev-item-title">${escapeHtml(ensureSentenceStartsCapitalized(sanitizeSnippet(formatOptionalText(exercise.title, "Development Exercise"), "Development Exercise")))}</div><p>${escapeHtml(ensureSentenceStartsCapitalized(sanitizeSnippet(formatOptionalText(exercise.text, "Not detected in assigned PDF."), "Not detected in assigned PDF.")))}</p></div>`,
      )
      .join(""),
  );
  const devExerciseComponentData = buildDevExerciseComponentData({
    ...REPORT,
    developmentExercises: exercises,
  });
  setText(
    'devExerciseSummary',
    formatOptionalText(
      devExerciseComponentData.summary,
      "Growth paths are generated from integration and strain context once report data is available.",
    ),
  );
  setHtml(
    'devExercisePaths',
    buildDevExercisePathHtml(devExerciseComponentData.paths) ||
      '<div class="dev-item"><div class="dev-item-title">Growth Path 1</div><p>Not detected in assigned PDF.</p></div>',
  );

  const diagnostics = REPORT.dataQualityDiagnostics || null;
  setText('diagnosticsSummary', formatOptionalText(diagnostics?.summary, 'No diagnostics loaded yet.'));
  const diagnosticIssues = Array.isArray(diagnostics?.issues) ? diagnostics.issues.filter(Boolean) : [];
  setHtml(
    'diagnosticsIssues',
    diagnosticIssues.length
      ? diagnosticIssues.map((issue) => `<div class="ti"><div class="tic neg">!</div><div class="tt">${issue}</div></div>`).join("")
      : '<div class="ti"><div class="tic pos">✓</div><div class="tt">No critical data quality issues detected.</div></div>',
  );

  const centerScores = REPORT.centerScoresRaw || {};
  setCenterLevelChip('centerBodyChip', centerScores.body ?? null);
  setCenterLevelChip('centerHeartChip', centerScores.heart ?? null);
  setCenterLevelChip('centerHeadChip', centerScores.head ?? null);
  sortCenterExpressionRows(centerScores);

  const strain = REPORT.strainScoresRaw || {};
  renderStrainBreakdownRows(strain, REPORT.strain);
  const overallNumeric = toFiniteScoreOrNull(strain.overall);
  const fallbackStrainValues = Array.isArray(REPORT.strain)
    ? REPORT.strain
        .map((value) => toFiniteScoreOrNull(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const overall = Number.isFinite(overallNumeric)
    ? Math.max(0, Math.min(100, Math.round(overallNumeric)))
    : (fallbackStrainValues.length
        ? Math.round(fallbackStrainValues.reduce((a, b) => a + Number(b || 0), 0) / fallbackStrainValues.length)
        : null);
  if (Number.isFinite(overall)) {
    const level = scoreBandLabel(overall).toUpperCase();
    setText('strainOverallScore', `Overall level: ${level}`);
    setText('strainOverallLabel', `Overall strain is ${level}.`);
  } else {
    setText('strainOverallScore', "Overall level: NOT DETECTED");
    setText('strainOverallLabel', "Overall strain was not detected in the assigned report.");
  }

  const narrativeMap = new Map(
    strainNarratives.map((item) => [String(item.category || "").toLowerCase(), formatOptionalText(item.text, "Not detected in assigned PDF.")]),
  );
  const overallStrainSummary = formatOptionalText(REPORT.overallStrainSummary, "");
  const strainWriteupRows = buildSortedStrainWriteupRows(strain, REPORT.strain, overall);
  setHtml(
    'strainWriteupCards',
    strainWriteupRows
      .map((item) => {
        const visual = getStrainCardVisual(item.level, item.title);
        const detail =
          item.key === "overall"
            ? (overallStrainSummary || `Overall strain is ${String(item.level).toLowerCase()} in this report.`)
            : (narrativeMap.get(item.title.toLowerCase()) || getStrainCardFallbackText(item.title, item.level));
        const detailBody = formatStrainCardDetailContent(detail, item);
        return `<div class="card"><div class="ct">${item.title} — ${item.level}</div><div class="chip ${visual.chipClass}" style="margin-bottom:10px">${visual.chipLabel}</div>${detailBody}</div>`;
      })
      .join(""),
  );
  syncStrainOverviewCardHeight();
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(syncStrainOverviewCardHeight);
  }
  console.log('[strain] rendered write-up cards', strainWriteupRows);

  console.log('[charts] updated all chart and bar datasets', {
    profile: REPORT.profile,
    strain: REPORT.strain,
    strainScoresRaw: REPORT.strainScoresRaw,
    centerScoresRaw: REPORT.centerScoresRaw,
    instinctScoresRaw: REPORT.instinctScoresRaw,
    interactionScores: REPORT.interactionScores,
  });
  setText('worldviewValue', REPORT.worldview);
  setText('focusValue', REPORT.focus);
  setText('selfTalkValue', REPORT.selfTalk);
  document.getElementById('deepTitle').innerHTML = `<span class="title-icon-chip"><span class="title-icon">${iconSvg('users', 12, 'var(--blue)')}</span></span>${REPORT.deepTitle}`;
  setText('deepP1', REPORT.deep[0]);
  setText('deepP2', REPORT.deep[1]);
  setText('deepP3', REPORT.deep[2]);
  setText('deepP4', REPORT.deep[3]);
  const deepSummaryCard = document.getElementById('deepSummaryCard');
  if (deepSummaryCard) {
    const isAssignedPdfSummary = /assigned\s+pdf\s+summary/i.test(String(REPORT.deepTitle || ""));
    deepSummaryCard.style.display = isAssignedPdfSummary ? "none" : "block";
  }
  document.getElementById('languageTitle').innerHTML = `<span class="title-icon-chip"><span class="title-icon">${iconSvg('communication', 12, 'var(--blue)')}</span></span>Type ${REPORT.typeNumber} Communication Pattern`;
  setText('languageMeta', REPORT.meta);
  setText('refTypeTag', `Type ${REPORT.typeNumber} · ${String(REPORT.instinct || "").split(' — ')[0]}`);
  renderAdaptiveSectionCopy(REPORT);
  const spreadsheetFocusesFromReport = REPORT.spreadsheetFocuses && typeof REPORT.spreadsheetFocuses === "object"
    ? REPORT.spreadsheetFocuses
    : {};
  const resolveSpreadsheetFocusText = (primaryText) => {
    const primary = formatOptionalText(primaryText, "");
    if (primary && !isMissingExtractedText(primary)) return primary;
    return missingAssignedPdfText;
  };
  setText(
    'motivationSummary',
    resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.motivationSummary),
  );
  setText(
    'instinctGoalSelfPres',
    resolveSpreadsheetFocusText(spreadsheetFocusesFromReport?.instinctGoals?.selfPres),
  );
  setText(
    'instinctGoalSocial',
    resolveSpreadsheetFocusText(spreadsheetFocusesFromReport?.instinctGoals?.social),
  );
  setText(
    'instinctGoalOneOnOne',
    resolveSpreadsheetFocusText(spreadsheetFocusesFromReport?.instinctGoals?.oneOnOne),
  );
  setText(
    'developingAsCopy',
    resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.developingAsCopy),
  );
  setText(
    'conflictResponseCopy',
    resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.conflictResponseCopy),
  );
  setText(
    'conflictTriggeredCopy',
    resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.conflictTriggeredCopy),
  );
  setHtml(
    'centeredDecisionCopy',
    renderNarrativeBullets(resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.centeredDecisionCopy), { maxItems: 8 }),
  );
  setHtml(
    'decisionImpactCopy',
    renderNarrativeBullets(resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.decisionImpactCopy), { maxItems: 10 }),
  );
  setHtml(
    'decisionStrainCopy',
    renderNarrativeBullets(resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.decisionStrainCopy), { maxItems: 8 }),
  );
  setHtml(
    'strategicLeadershipCopy',
    renderNarrativeBullets(resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.strategicLeadershipCopy), { maxItems: 10 }),
  );
  setHtml(
    'teamImpactCopy',
    renderNarrativeBullets(resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.teamImpactCopy), { maxItems: 10 }),
  );
  setHtml(
    'interdependenceCopy',
    renderNarrativeBullets(resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.interdependenceCopy), { maxItems: 6 }),
  );
  setHtml(
    'coachingRelationshipCopy',
    renderNarrativeBullets(resolveSpreadsheetFocusText(spreadsheetFocusesFromReport.coachingRelationshipCopy), { maxItems: 10 }),
  );
  const bodyLanguageRows = Array.isArray(spreadsheetFocusesFromReport.bodyLanguageRows)
    ? spreadsheetFocusesFromReport.bodyLanguageRows.filter(Boolean)
    : [];
  const resolvedBodyLanguageRows = bodyLanguageRows.length ? bodyLanguageRows : [missingAssignedPdfText];
  setHtml(
    'communicationBodyLanguageList',
    renderBodyLanguageRows(resolvedBodyLanguageRows) ||
      '<div class="ti"><div class="tic neu">•</div><div class="tt">Not detected in assigned PDF.</div></div>',
  );
  console.log('[spreadsheet-focus] rendered section focus hydration', {
    source: bodyLanguageRows.length || Object.keys(spreadsheetFocusesFromReport).length ? "report-content" : "not-detected",
    hasMotivation: Boolean(spreadsheetFocusesFromReport.motivationSummary),
    hasInstinctGoals: Boolean(spreadsheetFocusesFromReport?.instinctGoals),
    bodyLanguageRows: resolvedBodyLanguageRows.length,
    hasConflictResponse: Boolean(spreadsheetFocusesFromReport.conflictResponseCopy),
    hasCenteredDecision: Boolean(spreadsheetFocusesFromReport.centeredDecisionCopy),
    hasStrategicLeadership: Boolean(spreadsheetFocusesFromReport.strategicLeadershipCopy),
    hasTeamImpact: Boolean(spreadsheetFocusesFromReport.teamImpactCopy),
    hasCoachingRelationship: Boolean(spreadsheetFocusesFromReport.coachingRelationshipCopy),
  });
  const teamStagesFromReport = REPORT.teamStageBreakdown && typeof REPORT.teamStageBreakdown === "object"
    ? REPORT.teamStageBreakdown
    : {};
  const resolveTeamStageText = (primaryText) => {
    const primary = formatOptionalText(primaryText, "");
    if (primary && !isMissingExtractedText(primary)) return primary;
    return missingAssignedPdfText;
  };
  setHtml('teamStageForming', renderTeamStageBullets(resolveTeamStageText(teamStagesFromReport.forming)));
  setHtml('teamStageStorming', renderTeamStageBullets(resolveTeamStageText(teamStagesFromReport.storming)));
  setHtml('teamStageNorming', renderTeamStageBullets(resolveTeamStageText(teamStagesFromReport.norming)));
  setHtml('teamStagePerforming', renderTeamStageBullets(resolveTeamStageText(teamStagesFromReport.performing)));
  console.log('[team-stage] rendered stage breakdown', {
    source: Object.keys(teamStagesFromReport).length ? "report-content" : "not-detected",
    forming: Boolean(teamStagesFromReport.forming),
    storming: Boolean(teamStagesFromReport.storming),
    norming: Boolean(teamStagesFromReport.norming),
    performing: Boolean(teamStagesFromReport.performing),
  });

  const traitChips = document.getElementById('traitChips');
  traitChips.innerHTML = (REPORT.traits || []).map(trait => `<span class="chip cgn">${trait}</span>`).join('');

  updateCharts();
  buildReportModuleIndex();
  genReflection();
}

function applyAssignedPdfReport(payload) {
  try {
    REPORT = buildPdfOnlyReport(payload);
    latestAssignedPdfReport = REPORT;
    const isClientReportView = currentReportViewMode === "client-report";
    currentReportViewMode = isClientReportView ? "client-report" : "my-report";
    reflectionDeck = buildReflectionDeck(REPORT);
    renderReportFromState(false);
  } catch (error) {
    console.log("[report-ingest] Failed to apply assigned PDF dashboard content", error);
  }
}

function setupReportSelectorHandler() {
  const reportSelector = document.getElementById('reportSelector');
  if (!reportSelector) return;
  if (reportSelector.dataset.bound === "1") return;

  reportSelector.addEventListener("change", onReportSelectorChange);
  reportSelector.addEventListener("input", onReportSelectorChange);
  console.log("[report-switch] bound selector listeners");
  reportSelector.dataset.bound = "1";
}

function setupClientReportSelectorHandler() {
  const clientReportSelector = getClientReportSelector();
  if (!clientReportSelector) return;
  if (clientReportSelector.dataset.bound === "1") return;

  clientReportSelector.addEventListener("change", onClientReportSelectorChange);
  clientReportSelector.addEventListener("input", onClientReportSelectorChange);
  console.log("[client-report-switch] bound selector listeners");
  clientReportSelector.dataset.bound = "1";
}

function syncSelectedExampleReport() {
  try {
    if (currentReportViewMode === "client-report") return;
    const reportSelector = getReportSelector();
    if (!reportSelector) return;
    const selectedType = String(reportSelector.value || "").trim();
    if (!/^[1-9]$/.test(selectedType)) return;
    if (currentReportViewMode !== "example") {
      console.log("[report-switch] forcing example mode from selector value", {
        selectedType,
        previousMode: currentReportViewMode,
      });
      currentReportViewMode = "example";
    }
    if (selectedType === String(lastAppliedExampleType || "")) return;
    console.log("[report-switch] selector/render drift detected; reapplying", {
      selectedType,
      lastAppliedExampleType,
    });
    applyReport(selectedType);
  } catch (error) {
    console.log("[report-switch] failed to sync selected example report", error);
  }
}

function onReportSelectorChange(event) {
  const selectedType = String(event?.target?.value || getReportSelector()?.value || "").trim();
  const isMyReport = selectedType === "my-report";
  console.log('[report-switch] selector changed to', selectedType);
  if (isMyReport) {
    currentClientReportId = null;
    resetClientReportSelectorSelection();
    currentReportViewMode = "my-report";
    if (latestReportActiveData?.isAuthenticated && isAssignedReportAvailable(latestReportActiveData)) {
      assignedReportIngested = false;
      latestAssignedPdfReport = null;
      ingestAssignedReportIntoDashboard(latestReportActiveData);
      return;
    }
    alert("No active assigned report was found for this account.");
    const fallbackType = String(REPORT?.typeNumber || "8");
    if (event?.target) event.target.value = fallbackType;
    currentReportViewMode = "example";
    applyReport(fallbackType);
    return;
  }
  currentClientReportId = null;
  resetClientReportSelectorSelection();
  currentReportViewMode = "example";
  applyReport(selectedType);
}

function onClientReportSelectorChange(event) {
  const selectedReportId = String(event?.target?.value || getClientReportSelector()?.value || "").trim();
  if (!selectedReportId) {
    currentClientReportId = null;
    return;
  }

  const selectedClientReport = latestAdminClientReportsById.get(selectedReportId);
  if (!selectedClientReport) {
    console.log("[client-report-switch] selected report id missing from cache", {
      selectedReportId,
      availableIds: latestAdminClientReports.map((clientReport) => clientReport?.id).filter(Boolean),
    });
    return;
  }

  currentClientReportId = selectedReportId;
  currentReportViewMode = "client-report";
  assignedReportIngested = false;
  latestAssignedPdfReport = null;
  ingestAssignedReportIntoDashboard(selectedClientReport);
}

function genReflection() {
  const options = reflectionDeck[refCat];
  const choice = options[Math.floor(Math.random() * options.length)];
  console.log('[reflection] category', refCat, 'choice', choice);
  document.getElementById('refCatTag').textContent = refCatLabels[refCat];
  document.getElementById('refCard').innerHTML = `<p class="sb-tip">${choice}</p>`;
}

function setRef(cat, btn) {
  refCat = cat;
  console.log('[reflection] switching category', cat);
  document.querySelectorAll('.sb-cat').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  genReflection();
}

function toggleReflections(minimize) {
  const widget = document.getElementById('reflectionWidget');
  if (!widget) return;
  widget.classList.toggle('minimized', minimize);
}

window.addEventListener('load', () => {
  setupSearchPopoutHandlers();
  // Bind report selector first so it still works even if later setup code fails.
  setupReportSelectorHandler();
  setupClientReportSelectorHandler();
  window.setInterval(syncSelectedExampleReport, 400);
  decorateInterfaceIcons();
  buildReportModuleIndex();

  const focusSubmit = document.getElementById('focusSubmit');
  if (focusSubmit) focusSubmit.addEventListener('click', runFocusFilter);
  const focusReset = document.getElementById('focusReset');
  if (focusReset) focusReset.addEventListener('click', resetFocusPrompt);
  const searchButton = document.getElementById('searchEverywhereButton');
  if (searchButton) searchButton.addEventListener('click', runSearchEverywhere);
  const searchInput = document.getElementById('searchEverywhereInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearchEverywhere();
      }
    });
  }
  window.addEventListener('resize', syncStrainOverviewCardHeight);
});
