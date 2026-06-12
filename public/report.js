const AUTH_BASE_URL =
  (window.__AUTH_BASE_URL__ && String(window.__AUTH_BASE_URL__).trim()) ||
  window.localStorage.getItem("AUTH_BASE_URL") ||
  window.location.origin;
const DASHBOARD_REHYDRATE_STORAGE_KEY = "admin-review:dashboard-rehydrate";
const DASHBOARD_REHYDRATE_CHANNEL = "admin-review-dashboard-sync";

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

function isLocalhostHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

function isLocalhostRuntime() {
  return isLocalhostHostname(window.location.hostname);
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
  control.style.display = SHOW_EXAMPLE_REPORT_DROPDOWN && visible ? "flex" : "none";
}

function setClientReportSwitchVisible(visible) {
  const control = getClientReportSwitchControl();
  if (!control) return;
  control.style.display = SHOW_CLIENT_REPORT_DROPDOWN && visible ? "flex" : "none";
}

function canViewExampleReports({ email, isAuthenticated }) {
  if (!Boolean(isAuthenticated)) return true;
  return hasAdminAccess(email);
}

const SHOW_EXAMPLE_REPORT_DROPDOWN = false;
const SHOW_CLIENT_REPORT_DROPDOWN = true;
const DEFAULT_EXAMPLE_REPORT_TYPE = "3";
const DASHBOARD_COPY_HYDRATION_CLEANUP_ROUTE = "/api/report-hydration/dashboard-copy/cleanup";
const DASHBOARD_COPY_HYDRATION_LLM_TIMEOUT_MS = 75_000;
const DASHBOARD_COPY_HYDRATION_CACHE = new Map();
const INSTRUCTION_EXTRACTION_ENGINE_CACHE = new WeakMap();

let assignedReportIngested = false;
let exampleReportInitialized = false;
let latestReportActiveData = null;
let currentSignedInUser = null;
let currentReportViewMode = "example";
let latestAssignedPdfReport = null;
let lastAppliedExampleType = DEFAULT_EXAMPLE_REPORT_TYPE;
let latestAdminClientReports = [];
let latestAdminClientReportsById = new Map();
let currentClientReportId = null;
let activeAssignedIngestionToken = 0;
let lastDashboardRehydrateNonce = null;
let dashboardRehydrateListenersBound = false;

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

function invalidateAssignedReportIngestion(reason = "unknown") {
  activeAssignedIngestionToken += 1;
  assignedReportIngested = false;
  console.log("[report-ingest] invalidated active ingestion token", {
    reason,
    activeAssignedIngestionToken,
  });
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

function findClientReportForSignedInUser(clientReports, signedInUserEmail) {
  const normalizedSignedInEmail = normalizeEmail(signedInUserEmail);
  if (!normalizedSignedInEmail) return null;
  const safeClientReports = Array.isArray(clientReports) ? clientReports : [];
  return (
    safeClientReports.find(
      (clientReport) => normalizeEmail(clientReport?.userEmail) === normalizedSignedInEmail,
    ) || null
  );
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
  reportSelector.value = DEFAULT_EXAMPLE_REPORT_TYPE;
  console.log("[report-switch] applied default initial example report", DEFAULT_EXAMPLE_REPORT_TYPE);
  applyReport(DEFAULT_EXAMPLE_REPORT_TYPE);
  exampleReportInitialized = true;
}

function applySelectedExampleReportOrFallback() {
  const reportSelector = getReportSelector();
  const selectedType = String(reportSelector?.value || "").trim();
  const nextType = /^[1-9]$/.test(selectedType) ? selectedType : DEFAULT_EXAMPLE_REPORT_TYPE;
  if (reportSelector) reportSelector.value = nextType;
  invalidateAssignedReportIngestion("apply-selected-example-report");
  currentClientReportId = null;
  resetClientReportSelectorSelection();
  currentReportViewMode = "example";
  latestAssignedPdfReport = null;
  applyReport(nextType);
  exampleReportInitialized = true;
}

function getReportSelector() {
  return document.getElementById("reportSelector");
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

function stripControlNoiseCharacters(rawText) {
  return String(rawText || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\uFFFD/g, " ");
}

function hasExcessiveSymbolNoise(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const noisyTokens = tokens.filter((token) => {
    const cleanedToken = String(token || "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (/[A-Za-z]/.test(cleanedToken)) return false;
    if (/^\d{1,4}$/.test(cleanedToken)) return false;
    if (/^[•●▪◦·\-–—.,;:!?'"()]+$/.test(token)) return false;
    if (/[^A-Za-z0-9.,;:!?'"()\-–—•●▪◦]/.test(token)) return true;
    return token.length <= 3;
  });
  return noisyTokens.length >= 8 && noisyTokens.length / tokens.length >= 0.28;
}

function isCorruptedExtractedSnippet(value) {
  const raw = String(value || "");
  if (!raw.trim()) return true;
  if (/[\u0000-\u001F\u007F-\u009F]/.test(raw)) return true;
  const normalized = normalizeExtractedText(raw);
  if (!normalized) return true;
  if (/(?:\bPage\s*\d{1,3}\b\s*){2,}/i.test(normalized)) return true;
  if (hasExcessiveSymbolNoise(normalized)) return true;
  return false;
}

function stripPdfFooterNoiseFragments(rawText) {
  return String(rawText || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\uFFFD/g, " ")
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
    .replace(/\b(?:Page|Pg\.?)\s*\d{1,3}\s*(?:of|\/)\s*\d{1,3}\b/gi, " ")
    .replace(/\b(?:Page|Pg\.?)\s*\d{1,3}\b/gi, " ")
    .replace(/\[\s*Page\s*\d{1,3}\s*\]/gi, " ")
    .replace(/\bPage\s*\d{1,3}\s+Page\s*\d{1,3}\b/gi, " ")
    .replace(/\b\d{1,3}\s*(?:of|\/)\s*\d{1,3}\b(?=\s*(?:$|STRICTLY|CONFIDENTIAL|COPYRIGHT|Integrative|Enneagram|Ben\s*Russell))/gi, " ")
    .replace(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\s*20\d{2}\s*\[\s*ENGLISH\s*\]/gi, " ")
    .replace(/\bSTRICTLY\s*CONFIDENTIAL(?:\s+INDIVIDUAL)?(?:\s+PROFESSIONAL)?(?:\s+Enneagram\s*Report)?\b/gi, " ")
    .replace(/\bCopyright\s*\d{2,4}\s*[-–]\s*\d{2,4}\b/gi, " ")
    .replace(/\bIntegrative\s*Enneagram(?:\s*Solutions)?(?:\s*Ben\s*Russell)?\b/gi, " ")
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
    )
    .replace(/(?:[^\w\s.,;:!?'"()\-–—•●▪◦]{1,2}\s*){8,}/g, " ");
}

function normalizeExtractedText(rawText) {
  return stripPdfFooterNoiseFragments(rawText)
    .replace(/\[\s*Page\s*\d{1,3}\s*\]/gi, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function inferTypeFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const score = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0 };
  const weightedPatterns = [
    {
      regex: /\bM\s*A\s*I\s*N\s*T\s*Y\s*P\s*E\s*(?:#|No\.?|Number)?\s*[:\-]?\s*(?:T\s*Y\s*P\s*E\s*)?([1-9])\b/gi,
      weight: 28,
      source: "mainTypeLetterSpaced",
    },
    {
      regex: /Main\s*Type\s*(?:#|No\.?|Number)?\s*[:\-]?\s*(?:Type\s*)?([1-9])\b/gi,
      weight: 26,
      source: "mainTypeHash",
    },
    { regex: /Main\s*Type\s*[:\-]?\s*Type\s*([1-9])\b/gi, weight: 24, source: "mainType" },
    { regex: /\bMain\s*Type\b[^0-9]{0,24}([1-9])\b/gi, weight: 18, source: "mainTypeLoose" },
    {
      regex: /\bA\s+deeper\s+understanding\s+of\s+the\s+(?:SX|SO|SP)\s*[—-]\s*([1-9])\b/gi,
      weight: 22,
      source: "deeperUnderstanding",
    },
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
    { regex: /type\s*([1-9])\s+which\s+is\s+also\s+known\s+as/gi, weight: 12, source: "typeKnownAs" },
    { regex: /Your\s*Type\s*[:\-#]?\s*([1-9])\b/gi, weight: 12, source: "yourType" },
    { regex: /\bType\s*([1-9])\s*[·•|]\s*(?:SX|SO|SP)\b/gi, weight: 10, source: "typeWithInstinctTag" },
    { regex: /Enneagram\s+type\s*([1-9])\b/gi, weight: 10, source: "enneagramType" },
    { regex: /\bTYPE\s*([1-9])\s*(?:\||[—-])/gi, weight: 6, source: "headerType" },
    { regex: /\bEnnea\s*([1-9])\b/gi, weight: 3, source: "ennea" },
    { regex: /Type\s*([1-9])\b/gi, weight: 1, source: "genericType" },
  ];

  let strongestSource = "none";
  let strongestWeight = 0;
  const blacklistedContext = /(all\s+9\s+types?|9\s+Enneagram\s+styles?)/i;
  const scoreTableContext = /(type\s*1\b.*type\s*2\b.*type\s*3\b)|(type\s*7\b.*type\s*8\b.*type\s*9\b)/i;

  for (const entry of weightedPatterns) {
    let match;
    while ((match = entry.regex.exec(normalized)) !== null) {
      const type = String(match[1] || "");
      if (!score[type]) continue;
      const contextStart = Math.max(0, match.index - 36);
      const contextEnd = Math.min(normalized.length, match.index + 54);
      const contextWindow = normalized.slice(contextStart, contextEnd);
      if (blacklistedContext.test(contextWindow)) continue;
      if (scoreTableContext.test(contextWindow)) continue;
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

function typeConfidenceRank(confidence) {
  const normalized = String(confidence || "").toLowerCase();
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  if (normalized === "low") return 1;
  return 0;
}

function selectPreferredTypeDetectionResult(results) {
  const candidates = Array.isArray(results)
    ? results.filter((entry) => entry && typeof entry === "object" && entry.type)
    : [];
  if (!candidates.length) return { type: null, confidence: "none", source: "none" };

  candidates.sort((a, b) => typeConfidenceRank(b.confidence) - typeConfidenceRank(a.confidence));
  return candidates[0];
}

function extractTypeNameFromPdfText(pdfText, detectedType) {
  const normalized = normalizeExtractedText(pdfText);
  const typeHint = detectedType ? String(detectedType) : "[1-9]";
  const patterns = [
    new RegExp(`you\\s+resonate\\s+with\\s+the\\s+Enneagram\\s+type\\s*${typeHint}\\s+which\\s+is\\s+also\\s+known\\s+as\\s*the\\s*([A-Za-z][A-Za-z\\s-]{2,40})`, "i"),
    new RegExp(`Main\\s*Type\\s*(?:#|No\\.?|Number)?\\s*[:\\-]?\\s*(?:Type\\s*)?${typeHint}\\s*[—-]\\s*([^\\.;\\n]{3,80})`, "i"),
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

function instinctValueToLabel(value) {
  const fromCode = instinctCodeToLabel(value);
  if (fromCode) return fromCode;
  const normalized = String(value || "").trim();
  return normalized || null;
}

const DOMINANT_INSTINCT_GOAL_ROW_CLASSES = Object.freeze([
  "is-dominant-sp",
  "is-dominant-so",
  "is-dominant-sx",
]);

function resolveDominantInstinctCode(instinctValue) {
  const normalized = String(instinctValue || "").trim().toUpperCase();
  if (!normalized) return null;
  if (/\bSP\b/.test(normalized) || /SELF[\s-]*PRESERVATION/.test(normalized)) return "SP";
  if (/\bSO\b/.test(normalized) || /\bSOCIAL\b/.test(normalized)) return "SO";
  if (/\bSX\b/.test(normalized) || /ONE[\s-]*ON[\s-]*ONE/.test(normalized) || /ONE[\s-]*TO[\s-]*ONE/.test(normalized)) return "SX";
  return null;
}

function renderDominantInstinctGoalBorder(instinctValue) {
  const instinctGoalRows = document.querySelectorAll(".instinct-goal-row");
  instinctGoalRows.forEach((row) => {
    row.classList.remove(...DOMINANT_INSTINCT_GOAL_ROW_CLASSES);
  });

  const dominantCode = resolveDominantInstinctCode(instinctValue);
  if (!dominantCode) {
    console.log("[instinct-goals] no dominant instinct code resolved for border styling", {
      instinctValue,
    });
    return;
  }

  const dominantRow = document.querySelector(`.instinct-goal-row[data-instinct-code="${dominantCode}"]`);
  if (!dominantRow) {
    console.log("[instinct-goals] dominant instinct row not found for border styling", {
      instinctValue,
      dominantCode,
    });
    return;
  }

  dominantRow.classList.add(`is-dominant-${dominantCode.toLowerCase()}`);
  console.log("[instinct-goals] applied dominant instinct border styling", {
    instinctValue,
    dominantCode,
  });
}

function normalizeAssignedIdentityValue(value) {
  const normalized = sanitizeSnippet(value || "", "").trim();
  if (!normalized) return null;
  if (isMissingExtractedText(normalized)) return null;
  if (normalized.toLowerCase() === "unknown") return null;
  return normalized;
}

const HYDRATION_SOURCE_PRIORITY = Object.freeze([
  "verification_python",
  "targeted_sections",
  "js_deterministic",
  "parsed_profile_llm",
  "dashboard_context_default",
]);

const HYDRATION_DETERMINISTIC_SOURCES = new Set([
  "verification_python",
  "targeted_sections",
  "js_deterministic",
]);

const ASSIGNED_HYDRATION_REQUIRED_SLOTS = Object.freeze([
  "worldviewValue",
  "focusValue",
  "coreFearValue",
  "selfTalkValue",
  "giftsValue",
  "vicesValue",
  "instinctGoalSelfPres",
  "instinctGoalSocial",
  "instinctGoalOneOnOne",
  "feedbackGuideMatrixBody",
  "devExercisePaths",
  "teamStageForming",
  "teamStageStorming",
  "teamStageNorming",
  "teamStagePerforming",
  "motivationSummary",
  "conflictResponseCopy",
  "decisionImpactCopy",
  "teamImpactCopy",
  "interdependenceCopy",
  "coachingRelationshipCopy",
  "overallStrainSummary",
  "strainWriteupCards",
]);

function hydrationSourcePriorityRank(source) {
  const normalizedSource = String(source || "").trim();
  const index = HYDRATION_SOURCE_PRIORITY.indexOf(normalizedSource);
  return index >= 0 ? index : HYDRATION_SOURCE_PRIORITY.length + 1;
}

function collectHydrationInformativeStrings(value, out = [], depth = 0) {
  if (depth > 6 || value == null) return out;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const normalized = normalizeAssignedIdentityValue(String(value));
    if (normalized) out.push(normalized);
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectHydrationInformativeStrings(entry, out, depth + 1));
    return out;
  }

  if (typeof value === "object") {
    Object.entries(value).forEach(([key, entryValue]) => {
      if (/^(type|label|title|key|category|tone|symbol|id)$/i.test(String(key || ""))) return;
      collectHydrationInformativeStrings(entryValue, out, depth + 1);
    });
  }
  return out;
}

function hasInformativeHydrationValue(value) {
  return collectHydrationInformativeStrings(value, []).length > 0;
}

function summarizeHydrationCandidatePreview(value) {
  const joined = collectHydrationInformativeStrings(value, [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join(" | ");
  if (!joined) return "";
  return joined.length > 180 ? `${joined.slice(0, 180).trim()}...` : joined;
}

function createHydrationAuditTracker() {
  const hydrationSourceAudit = {};
  const duplicateCandidates = [];
  const seenDuplicateSlots = new Set();
  let deterministicHitCount = 0;
  let llmFallbackCount = 0;

  const buildCandidateList = (candidates) =>
    (Array.isArray(candidates) ? candidates : [])
      .filter((candidate) => candidate && typeof candidate === "object")
      .map((candidate, index) => ({
        source: String(candidate.source || "").trim() || "dashboard_context_default",
        value: candidate.value,
        index,
      }));

  const selectSource = (candidates, fallbackValue) => {
    const ranked = buildCandidateList(candidates).sort((left, right) => {
      const rankDelta = hydrationSourcePriorityRank(left.source) - hydrationSourcePriorityRank(right.source);
      if (rankDelta !== 0) return rankDelta;
      return left.index - right.index;
    });
    const chosen = ranked.find((candidate) => hasInformativeHydrationValue(candidate.value));
    if (chosen) return chosen;
    return {
      source: "dashboard_context_default",
      value: fallbackValue,
      index: Number.MAX_SAFE_INTEGER,
    };
  };

  const captureDuplicateCandidates = (slotKey, candidates) => {
    const informativeRows = buildCandidateList(candidates)
      .filter((candidate) => hasInformativeHydrationValue(candidate.value))
      .map((candidate) => ({
        source: candidate.source,
        preview: summarizeHydrationCandidatePreview(candidate.value),
      }))
      .filter((candidate) => Boolean(candidate.preview));

    const uniquePreviews = Array.from(new Set(informativeRows.map((row) => row.preview)));
    if (uniquePreviews.length <= 1 || seenDuplicateSlots.has(slotKey)) return;
    seenDuplicateSlots.add(slotKey);
    duplicateCandidates.push({
      kind: "source_conflict",
      slotKey,
      candidates: informativeRows,
    });
  };

  const updateCounters = (source) => {
    if (HYDRATION_DETERMINISTIC_SOURCES.has(source)) deterministicHitCount += 1;
    if (source === "parsed_profile_llm") llmFallbackCount += 1;
  };

  const setAuditSource = (slotKey, source) => {
    if (!slotKey) return;
    const normalizedSource = String(source || "dashboard_context_default").trim() || "dashboard_context_default";
    const previousSource = hydrationSourceAudit[slotKey];
    if (previousSource) return;
    hydrationSourceAudit[slotKey] = normalizedSource;
    updateCounters(normalizedSource);
  };

  return {
    resolve(slotKey, candidates, options = {}) {
      const fallbackValue = options?.fallbackValue;
      const selected = selectSource(candidates, fallbackValue);
      captureDuplicateCandidates(slotKey, candidates);
      setAuditSource(slotKey, selected.source);
      return selected.value;
    },
    record(slotKey, candidates, fallbackValue) {
      const selected = selectSource(candidates, fallbackValue);
      captureDuplicateCandidates(slotKey, candidates);
      setAuditSource(slotKey, selected.source);
      return selected.source;
    },
    summarize(requiredSlots = ASSIGNED_HYDRATION_REQUIRED_SLOTS) {
      const required = Array.isArray(requiredSlots) ? requiredSlots.slice() : [];
      const hydratedSlots = Object.keys(hydrationSourceAudit);
      const missingSlots = required.filter((slotKey) => !hydrationSourceAudit[slotKey]);
      return {
        requiredSlots: required,
        hydratedSlots,
        missingSlots,
        duplicateCandidates: duplicateCandidates.slice(),
        deterministicHitCount,
        llmFallbackCount,
        hydrationSourceAudit: { ...hydrationSourceAudit },
      };
    },
    sourceAudit() {
      return { ...hydrationSourceAudit };
    },
  };
}

function collectAssignedHydrationDomCoverage(requiredSlots) {
  const required = Array.isArray(requiredSlots) ? requiredSlots : [];
  const hydratedSlots = [];
  const missingSlots = [];
  const valueToSlots = new Map();

  required.forEach((slotKey) => {
    const node = document.getElementById(slotKey);
    if (!node) {
      missingSlots.push(slotKey);
      return;
    }

    const nodeText = normalizeExtractedText(
      node.textContent ||
        node.innerText ||
        "",
    );
    if (!nodeText) {
      missingSlots.push(slotKey);
      return;
    }

    hydratedSlots.push(slotKey);
    if (isMissingExtractedText(nodeText)) return;
    if (nodeText.length < 16) return;

    const key = nodeText.toLowerCase();
    const slots = valueToSlots.get(key) || [];
    slots.push(slotKey);
    valueToSlots.set(key, slots);
  });

  const duplicateFilledSlots = Array.from(valueToSlots.entries())
    .filter(([, slots]) => Array.isArray(slots) && slots.length > 1)
    .map(([normalizedValue, slots]) => ({
      kind: "dom_duplicate_fill",
      slots,
      valuePreview: normalizedValue.length > 180 ? `${normalizedValue.slice(0, 180).trim()}...` : normalizedValue,
    }));

  return {
    hydratedSlots,
    missingSlots,
    duplicateFilledSlots,
  };
}

function applyAssignedHydrationContractDiagnostics(report) {
  if (!report || typeof report !== "object") return;
  const currentDiagnostics =
    report?.dataQualityDiagnostics && typeof report.dataQualityDiagnostics === "object"
      ? report.dataQualityDiagnostics
      : {
          summary: "No diagnostics loaded yet.",
          issues: [],
          verification: {},
        };
  const currentHydration =
    currentDiagnostics?.hydration && typeof currentDiagnostics.hydration === "object"
      ? currentDiagnostics.hydration
      : {};
  const requiredSlots = Array.isArray(currentHydration.requiredSlots)
    ? currentHydration.requiredSlots
    : ASSIGNED_HYDRATION_REQUIRED_SLOTS;
  const sourceAudit =
    report?.hydrationSourceAudit && typeof report.hydrationSourceAudit === "object"
      ? report.hydrationSourceAudit
      : (currentHydration?.hydrationSourceAudit && typeof currentHydration.hydrationSourceAudit === "object"
          ? currentHydration.hydrationSourceAudit
          : {});
  const domCoverage = collectAssignedHydrationDomCoverage(requiredSlots);
  const mergedDuplicateCandidates = [
    ...(Array.isArray(currentHydration.duplicateCandidates) ? currentHydration.duplicateCandidates : []),
    ...domCoverage.duplicateFilledSlots,
  ];
  const duplicateCandidates = Array.from(
    new Map(
      mergedDuplicateCandidates.map((entry) => [JSON.stringify(entry), entry]),
    ).values(),
  );
  const hydration = {
    requiredSlots: Array.isArray(requiredSlots) ? requiredSlots.slice() : [],
    hydratedSlots: domCoverage.hydratedSlots,
    missingSlots: domCoverage.missingSlots,
    duplicateCandidates,
    deterministicHitCount: Number.isFinite(Number(currentHydration.deterministicHitCount))
      ? Number(currentHydration.deterministicHitCount)
      : 0,
    llmFallbackCount: Number.isFinite(Number(currentHydration.llmFallbackCount))
      ? Number(currentHydration.llmFallbackCount)
      : 0,
    hydrationSourceAudit: sourceAudit,
  };

  report.hydrationSourceAudit = sourceAudit;
  report.dataQualityDiagnostics = {
    ...currentDiagnostics,
    hydration,
  };

  console.log("[hydration-contract] assigned/client slot coverage", {
    requiredSlots: hydration.requiredSlots.length,
    hydratedSlots: hydration.hydratedSlots.length,
    missingSlots: hydration.missingSlots,
    duplicateCandidates: hydration.duplicateCandidates,
    deterministicHitCount: hydration.deterministicHitCount,
    llmFallbackCount: hydration.llmFallbackCount,
    hydrationSourceAudit: sourceAudit,
  });
}

function normalizeDetectedTypeCandidate(value) {
  const normalized = normalizeAssignedIdentityValue(value);
  if (!normalized) return null;
  const match = normalized.match(/[1-9]/);
  return match?.[0] || null;
}

function extractInstinctFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText);
  const dominantCodeMatch = normalized.match(/\bDominant\s*Instinct\s*[:\-]?\s*(SO|SP|SX)\b/i);
  if (dominantCodeMatch?.[1]) {
    return instinctCodeToLabel(dominantCodeMatch[1]) || dominantCodeMatch[1].toUpperCase();
  }

  const codedMatch = normalized.match(/\bwith\s+a\s+(SO|SP|SX)\s+Instinct(?:\b|[A-Z])/i);
  if (codedMatch?.[1]) {
    return instinctCodeToLabel(codedMatch[1]) || codedMatch[1].toUpperCase();
  }

  const patterns = [
    /\bDominant\s*Instinct\s*[:\-]?\s*(SO|SP|SX)\s*[—-]\s*(Social|Self[\s-]?Preservation|One[\s-]?on[\s-]?One)\b/i,
    /Dominant\s*Instinct\s*[:\-]?\s*([A-Za-z]{2,4}\s*[—-]\s*[A-Za-z][A-Za-z\s-]{2,40})/i,
    /\b(SO|SP|SX)\s*[—-]\s*(Social|Self[\s-]?Preservation|One[\s-]?on[\s-]?One)\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1] && /^[a-z]{2,3}$/i.test(String(match[1]))) {
      return instinctCodeToLabel(match[1]) || String(match[1]).toUpperCase();
    }
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
      .replace(/\u0000/g, " ")
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

const CORE_PATTERN_BULLET_DEFINITIONS = [
  {
    key: "action",
    label: "Typical Action Patterns",
    fallbackText: "Not detected in assigned PDF.",
  },
  {
    key: "thinking",
    label: "Typical Thinking Patterns",
    fallbackText: "Not detected in assigned PDF.",
  },
  {
    key: "feeling",
    label: "Typical Feeling Patterns",
    fallbackText: "Not detected in assigned PDF.",
  },
];

function sanitizeCorePatternBulletText(value) {
  const source = cleanPdfExtractedValue(value || "");
  if (!source) return null;

  let cleaned = source
    .replace(/^\s*Typical\s*(?:Action|Thinking|Feeling)\s*Patterns?\s*[:\-]?\s*/i, "")
    .replace(/:\s*(?=[A-Za-z])/g, ": ")
    .trim();

  if (!cleaned) return null;

  // Some OCR page orders repeat a second core-pattern heading inside the same
  // section text (for example, "TypicalThinking Patterns" leaking into feeling copy).
  // Treat any subsequent core-pattern heading as a hard boundary.
  const repeatedCorePatternHeading =
    /(?:^|[\n\r]|[.!?]\s+|(?:•|●|▪|◦|·)\s*)Typical\s*(?:Action|Thinking|Feeling)\s*Patterns?\s*[:\-]?/i;
  const repeatedHeadingMatch = repeatedCorePatternHeading.exec(cleaned);
  if (repeatedHeadingMatch) {
    const boundaryIndex = Number(repeatedHeadingMatch.index || 0);
    if (boundaryIndex === 0) return null;
    cleaned = cleaned.slice(0, boundaryIndex).trim();
  }

  const spilloverPattern =
    /\b(?:Worldview|World\s*View|Focus\s*of\s*Attention|Core\s*Fear|Self[-\s]*Talk|Gifts?|Vices?)\b\s*(?:[:.\-]|$)/i;
  const spilloverMatch = spilloverPattern.exec(cleaned);
  if (spilloverMatch) {
    const boundaryIndex = Number(spilloverMatch.index || 0);
    if (boundaryIndex === 0) return null;
    cleaned = cleaned.slice(0, boundaryIndex).trim();
  }

  const headingSpilloverPattern = /\b(?:Detailed\s+Enneagram\s+Description|Your\s+main\s+Enneagram\s+style)\b/i;
  const headingSpilloverMatch = headingSpilloverPattern.exec(cleaned);
  if (headingSpilloverMatch) {
    const boundaryIndex = Number(headingSpilloverMatch.index || 0);
    if (boundaryIndex === 0) return null;
    cleaned = cleaned.slice(0, boundaryIndex).trim();
  }

  if (!cleaned) return null;
  return ensureSentenceStartsCapitalized(cleaned);
}

function normalizeCorePatternBullets(value) {
  const rows = Array.isArray(value) ? value : [];
  const byKey = new Map();
  const byLabel = new Map();
  rows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const key = String(row?.key || "").trim().toLowerCase();
    const label = String(row?.label || "").trim();
    const text = sanitizeCorePatternBulletText(row?.text);
    if (!text) return;
    if (key) byKey.set(key, text);
    if (label) byLabel.set(label.toLowerCase(), text);
  });

  return CORE_PATTERN_BULLET_DEFINITIONS.map((definition) => {
    const text =
      byKey.get(definition.key) ||
      byLabel.get(String(definition.label || "").toLowerCase()) ||
      null;
    return {
      key: definition.key,
      label: definition.label,
      text: text || definition.fallbackText,
    };
  });
}

function mergeCorePatternBullets(preferredBullets, fallbackBullets) {
  const preferred = normalizeCorePatternBullets(preferredBullets);
  const fallback = normalizeCorePatternBullets(fallbackBullets);
  return CORE_PATTERN_BULLET_DEFINITIONS.map((definition, index) => {
    const preferredRow = preferred[index] || {};
    const fallbackRow = fallback[index] || {};
    const preferredText = sanitizeSnippet(preferredRow?.text, null);
    const fallbackText = sanitizeSnippet(fallbackRow?.text, null);
    const text =
      (preferredText && !isMissingExtractedText(preferredText) ? preferredText : null) ||
      (fallbackText && !isMissingExtractedText(fallbackText) ? fallbackText : null) ||
      definition.fallbackText;
    return {
      key: definition.key,
      label: definition.label,
      text,
    };
  });
}

function stripCorePatternSectionBoundarySpillover(value) {
  let cleaned = sanitizeSnippet(value, "");
  if (!cleaned) return null;
  cleaned = cleaned
    .replace(/^\s*Typical\s*(?:Action|Thinking|Feeling)\s*Patterns?\s*[:\-]?\s*/i, "")
    .trim();
  if (!cleaned) return null;

  const boundaryPattern = /\b(?:Blind\s*Spots?|BlindSpots|World\s*View|Worldview|Detailed\s+Enneagram\s+Description|Your\s+main\s+Enneagram\s+style|Focus\s+of\s+Attention|Core\s*Fear|Self[-\s]*Talk|Gifts?|Vices?|Development\s+Exercise)\b/i;
  const spilloverMatch = boundaryPattern.exec(cleaned);
  if (spilloverMatch) {
    const boundaryIndex = Number(spilloverMatch.index || 0);
    if (boundaryIndex === 0) return null;
    cleaned = cleaned.slice(0, boundaryIndex).trim();
  }

  return cleaned || null;
}

function corePatternTextHasSectionSpillover(text) {
  const cleaned = sanitizeSnippet(text, "");
  if (!cleaned) return false;
  return /\b(?:Blind\s*Spots?|BlindSpots|World\s*View|Worldview|Detailed\s+Enneagram\s+Description|Your\s+main\s+Enneagram\s+style|Focus\s+of\s+Attention|Core\s*Fear|Self[-\s]*Talk|Gifts?|Vices?|Development\s+Exercise)\b/i
    .test(cleaned);
}

function corePatternTextHasJoinedWordArtifacts(text) {
  const cleaned = sanitizeSnippet(text, "");
  if (!cleaned) return false;
  const longMergedConnectorWordPattern =
    /\b[a-z]{2,}(?:and|then|with|from|into|your|you|them|this|that|when|while|over|under|about|before|after|every|other|feel|move|work|take|make)[a-z]{2,}\b/i;
  const extraLongTokenPattern = /\b[A-Za-z]{22,}\b/;
  const camelJoinPattern = /\b[a-z]{2,}[A-Z][a-z]{2,}\b/;
  return (
    longMergedConnectorWordPattern.test(cleaned) ||
    extraLongTokenPattern.test(cleaned) ||
    camelJoinPattern.test(cleaned)
  );
}

function shouldRequestCorePatternHydrationCleanup(bullets) {
  const rows = normalizeCorePatternBullets(bullets);
  const informativeRows = rows.filter((row) => !isMissingExtractedText(row?.text));
  if (!informativeRows.length) return false;
  return informativeRows.some((row) => (
    corePatternTextHasSectionSpillover(row?.text) ||
    corePatternTextHasJoinedWordArtifacts(row?.text)
  ));
}

function resolveHydratedCorePatternBullets(value) {
  const normalizedRows = normalizeCorePatternBullets(value);
  const cleanedRows = normalizedRows.map((row) => ({
    key: row.key,
    label: row.label,
    text: stripCorePatternSectionBoundarySpillover(row?.text) || row?.text || null,
  }));
  return normalizeCorePatternBullets(cleanedRows);
}

const DASHBOARD_CLEANUP_STRAIN_CATEGORIES = [
  "Happiness",
  "Vocational",
  "Interpersonal",
  "Physical",
  "Environmental",
  "Psychological",
];
const DASHBOARD_CLEANUP_INSTINCT_GOAL_KEYS = ["selfPres", "social", "oneOnOne"];

function normalizeDashboardNarrativeCleanupText(value, fallback = null) {
  const cleaned = sanitizeSnippet(value || "", "");
  if (!cleaned) return fallback;
  return cleaned;
}

function normalizeDashboardNarrativeCleanupStrainRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return DASHBOARD_CLEANUP_STRAIN_CATEGORIES.map((category) => {
    const matched = safeRows.find(
      (row) => String(row?.category || "").trim().toLowerCase() === String(category).toLowerCase(),
    );
    const text = normalizeDashboardNarrativeCleanupText(matched?.text, null);
    return {
      category,
      text: text || "Not detected in assigned PDF.",
    };
  });
}

function normalizeDashboardNarrativeCleanupDevelopmentExercises(rows, maxItems = 12) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const normalizedRows = [];
  const seen = new Set();
  const safeMaxItems = Number.isFinite(Number(maxItems)) ? Math.max(1, Number(maxItems)) : 12;

  for (const row of safeRows) {
    const text = normalizeDashboardNarrativeCleanupText(row?.text ?? row, null);
    if (!text || isMissingExtractedText(text)) continue;
    const key = normalizeExtractedText(text).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalizedRows.push({
      title: normalizeDashboardNarrativeCleanupText(row?.title, null) || `Exercise ${normalizedRows.length + 1}`,
      text,
    });
    if (normalizedRows.length >= safeMaxItems) break;
  }

  if (!normalizedRows.length) {
    return [{ title: "Exercise 1", text: "Not detected in assigned PDF." }];
  }
  return normalizedRows;
}

function normalizeDashboardNarrativeCleanupSpreadsheetFocuses(value) {
  const safe = value && typeof value === "object" ? value : {};
  const instinctGoals = safe?.instinctGoals && typeof safe.instinctGoals === "object" ? safe.instinctGoals : {};
  const normalizedInstinctGoals = {
    selfPres:
      normalizeDashboardNarrativeCleanupText(instinctGoals?.selfPres, null) || "Not detected in assigned PDF.",
    social:
      normalizeDashboardNarrativeCleanupText(instinctGoals?.social, null) || "Not detected in assigned PDF.",
    oneOnOne:
      normalizeDashboardNarrativeCleanupText(instinctGoals?.oneOnOne, null) || "Not detected in assigned PDF.",
  };

  const developingAsCopy =
    normalizeDashboardNarrativeCleanupText(safe?.developingAsCopy, null) || "Not detected in assigned PDF.";
  const developingAsBullets = Array.from(
    new Set(
      (Array.isArray(safe?.developingAsBullets) ? safe.developingAsBullets : [])
        .map((row) => normalizeDashboardNarrativeCleanupText(row, null))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 12);
  const bodyLanguageRows = Array.from(
    new Set(
      (Array.isArray(safe?.bodyLanguageRows) ? safe.bodyLanguageRows : [])
        .map((row) => normalizeDashboardNarrativeCleanupText(row, null))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 10);
  const conflictTriggeredBullets = Array.from(
    new Set(
      (Array.isArray(safe?.conflictTriggeredBullets) ? safe.conflictTriggeredBullets : [])
        .map((row) => normalizeDashboardNarrativeCleanupText(row, null))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 16);

  return {
    motivationSummary:
      normalizeDashboardNarrativeCleanupText(safe?.motivationSummary, null) || "Not detected in assigned PDF.",
    instinctGoals: normalizedInstinctGoals,
    developingAsCopy,
    developingAsBullets: developingAsBullets.length ? developingAsBullets : [developingAsCopy],
    bodyLanguageRows: bodyLanguageRows.length ? bodyLanguageRows : ["Not detected in assigned PDF."],
    conflictResponseCopy:
      normalizeDashboardNarrativeCleanupText(safe?.conflictResponseCopy, null) || "Not detected in assigned PDF.",
    conflictTriggeredCopy:
      normalizeDashboardNarrativeCleanupText(safe?.conflictTriggeredCopy, null) || "Not detected in assigned PDF.",
    conflictTriggeredBullets: conflictTriggeredBullets.length
      ? conflictTriggeredBullets
      : ["Not detected in assigned PDF."],
    centeredDecisionCopy:
      normalizeDashboardNarrativeCleanupText(safe?.centeredDecisionCopy, null) || "Not detected in assigned PDF.",
    decisionImpactCopy:
      normalizeDashboardNarrativeCleanupText(safe?.decisionImpactCopy, null) || "Not detected in assigned PDF.",
    decisionStrainCopy:
      normalizeDashboardNarrativeCleanupText(safe?.decisionStrainCopy, null) || "Not detected in assigned PDF.",
    strategicLeadershipCopy:
      normalizeDashboardNarrativeCleanupText(safe?.strategicLeadershipCopy, null) || "Not detected in assigned PDF.",
    teamImpactCopy:
      normalizeDashboardNarrativeCleanupText(safe?.teamImpactCopy, null) || "Not detected in assigned PDF.",
    interdependenceCopy:
      normalizeDashboardNarrativeCleanupText(safe?.interdependenceCopy, null) || "Not detected in assigned PDF.",
    coachingRelationshipCopy:
      normalizeDashboardNarrativeCleanupText(safe?.coachingRelationshipCopy, null) || "Not detected in assigned PDF.",
  };
}

function normalizeDashboardNarrativeCleanupFeedbackRows(rows, maxItems = 9) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const output = [];
  const safeMaxItems = Number.isFinite(Number(maxItems)) ? Math.max(1, Number(maxItems)) : 9;
  for (const row of safeRows) {
    const type = normalizeDashboardNarrativeCleanupText(row?.type, null) || `Type ${output.length + 1}`;
    const label = normalizeDashboardNarrativeCleanupText(row?.label, null) || "";
    const guidance =
      normalizeDashboardNarrativeCleanupText(row?.guidance, null) || "Not detected in assigned PDF.";
    output.push({ type, label, guidance });
    if (output.length >= safeMaxItems) break;
  }
  if (!output.length) {
    return Array.from({ length: 9 }, (_, index) => ({
      type: `Type ${index + 1}`,
      label: "",
      guidance: "Not detected in assigned PDF.",
    }));
  }
  return output;
}

function normalizeDashboardNarrativeCleanupTeamStageBreakdown(value) {
  const safe = value && typeof value === "object" ? value : {};
  return {
    forming: normalizeDashboardNarrativeCleanupText(safe?.forming, null) || "Not detected in assigned PDF.",
    storming: normalizeDashboardNarrativeCleanupText(safe?.storming, null) || "Not detected in assigned PDF.",
    norming: normalizeDashboardNarrativeCleanupText(safe?.norming, null) || "Not detected in assigned PDF.",
    performing: normalizeDashboardNarrativeCleanupText(safe?.performing, null) || "Not detected in assigned PDF.",
  };
}

function normalizeDashboardNarrativeCleanupInput(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  return {
    corePatternBullets: resolveHydratedCorePatternBullets(safePayload?.corePatternBullets),
    strainQualitativeWriteups: normalizeDashboardNarrativeCleanupStrainRows(
      safePayload?.strainQualitativeWriteups,
    ),
    developmentExercises: normalizeDashboardNarrativeCleanupDevelopmentExercises(
      safePayload?.developmentExercises,
      12,
    ),
    feedbackGuideMatrix: normalizeDashboardNarrativeCleanupFeedbackRows(
      safePayload?.feedbackGuideMatrix,
      9,
    ),
    overallStrainSummary:
      normalizeDashboardNarrativeCleanupText(safePayload?.overallStrainSummary, null) ||
      "Not detected in assigned PDF.",
    spreadsheetFocuses: normalizeDashboardNarrativeCleanupSpreadsheetFocuses(
      safePayload?.spreadsheetFocuses,
    ),
    teamStageBreakdown: normalizeDashboardNarrativeCleanupTeamStageBreakdown(
      safePayload?.teamStageBreakdown,
    ),
  };
}

function hasDashboardInstinctGoalHeadingLeak(fieldKey, value) {
  const key = String(fieldKey || "").trim().toLowerCase();
  if (!key) return false;
  const text = String(value || "");
  if (!text) return false;

  const hasOneOnOneHeading = /\bOne(?:-| )On(?:-| )One\s*-\s*SX\b/i.test(text);
  const hasSocialHeading = /\bSocial\s*-\s*SO\b/i.test(text);
  const hasSelfPresHeading = /\bSelf(?:-| )Preservation\s*-\s*SP\b/i.test(text);
  const headingCount = [hasOneOnOneHeading, hasSocialHeading, hasSelfPresHeading].filter(Boolean).length;

  if (key === "social") return hasOneOnOneHeading || hasSelfPresHeading || headingCount > 1;
  if (key === "oneonone") return hasSocialHeading || hasSelfPresHeading || headingCount > 1;
  if (key === "selfpres") return hasOneOnOneHeading || hasSocialHeading || headingCount > 1;
  return false;
}

function dashboardNarrativeHasCleanupArtifacts(value, options = {}) {
  const fieldKey = String(options?.fieldKey || "").trim();
  const source = String(value || "");
  const cleaned = normalizeDashboardNarrativeCleanupText(source, "");
  if (!cleaned || isMissingExtractedText(cleaned)) return false;

  if (/[≡]/.test(source)) return true;
  if (hasDashboardInstinctGoalHeadingLeak(fieldKey, cleaned)) return true;
  if (/\b(?:Development\s*Exercise|Developing\s+As)\b/i.test(cleaned)) return true;
  if (/\bExercise\s*\d+\b/i.test(cleaned) && cleaned.split(/\s+/).filter(Boolean).length >= 10) return true;
  if (/\b(?:SO|SP|SX)\s*[—-]?\s*[1-9]\b/i.test(cleaned)) return true;
  if (/\b[a-z]{2,}(?:and|then|with|from|into|your|you|them|this|that|when|while|over|under|about|before|after|every|other|feel|move|work|take|make)[a-z]{2,}\b/i.test(cleaned)) {
    return true;
  }
  if (/\b[A-Za-z]{24,}\b/.test(cleaned)) return true;
  return false;
}

function shouldRequestDashboardNarrativesCleanup(payload) {
  const normalized = normalizeDashboardNarrativeCleanupInput(payload);
  const candidates = [
    ...((Array.isArray(normalized.corePatternBullets) ? normalized.corePatternBullets : []).map((row) => ({
      fieldKey: `corePattern:${String(row?.key || "").toLowerCase() || "unknown"}`,
      text: row?.text,
    }))),
    ...normalized.strainQualitativeWriteups.map((row) => ({
      fieldKey: `strain:${String(row?.category || "").toLowerCase()}`,
      text: row?.text,
    })),
    ...normalized.developmentExercises.map((row, index) => ({
      fieldKey: `exercise:${index + 1}`,
      text: row?.text,
    })),
    ...normalized.feedbackGuideMatrix.map((row, index) => ({
      fieldKey: `feedback:${index + 1}`,
      text: row?.guidance,
    })),
    {
      fieldKey: "overallStrainSummary",
      text: normalized.overallStrainSummary,
    },
    {
      fieldKey: "motivationSummary",
      text: normalized.spreadsheetFocuses?.motivationSummary,
    },
    {
      fieldKey: "developingAsCopy",
      text: normalized.spreadsheetFocuses?.developingAsCopy,
    },
    ...((Array.isArray(normalized.spreadsheetFocuses?.bodyLanguageRows)
      ? normalized.spreadsheetFocuses.bodyLanguageRows
      : []
    ).map((row, index) => ({ fieldKey: `bodyLanguageRows:${index + 1}`, text: row }))),
    {
      fieldKey: "conflictResponseCopy",
      text: normalized.spreadsheetFocuses?.conflictResponseCopy,
    },
    {
      fieldKey: "conflictTriggeredCopy",
      text: normalized.spreadsheetFocuses?.conflictTriggeredCopy,
    },
    ...((Array.isArray(normalized.spreadsheetFocuses?.conflictTriggeredBullets)
      ? normalized.spreadsheetFocuses.conflictTriggeredBullets
      : []
    ).map((row, index) => ({ fieldKey: `conflictTriggeredBullets:${index + 1}`, text: row }))),
    {
      fieldKey: "centeredDecisionCopy",
      text: normalized.spreadsheetFocuses?.centeredDecisionCopy,
    },
    {
      fieldKey: "decisionImpactCopy",
      text: normalized.spreadsheetFocuses?.decisionImpactCopy,
    },
    {
      fieldKey: "decisionStrainCopy",
      text: normalized.spreadsheetFocuses?.decisionStrainCopy,
    },
    {
      fieldKey: "strategicLeadershipCopy",
      text: normalized.spreadsheetFocuses?.strategicLeadershipCopy,
    },
    {
      fieldKey: "teamImpactCopy",
      text: normalized.spreadsheetFocuses?.teamImpactCopy,
    },
    {
      fieldKey: "interdependenceCopy",
      text: normalized.spreadsheetFocuses?.interdependenceCopy,
    },
    {
      fieldKey: "coachingRelationshipCopy",
      text: normalized.spreadsheetFocuses?.coachingRelationshipCopy,
    },
    ...((Array.isArray(normalized.spreadsheetFocuses?.developingAsBullets)
      ? normalized.spreadsheetFocuses.developingAsBullets
    : []
    ).map((row, index) => ({ fieldKey: `developingAsBullets:${index + 1}`, text: row }))),
    ...DASHBOARD_CLEANUP_INSTINCT_GOAL_KEYS.map((key) => ({
      fieldKey: key,
      text: normalized.spreadsheetFocuses?.instinctGoals?.[key],
    })),
    {
      fieldKey: "teamStageForming",
      text: normalized.teamStageBreakdown?.forming,
    },
    {
      fieldKey: "teamStageStorming",
      text: normalized.teamStageBreakdown?.storming,
    },
    {
      fieldKey: "teamStageNorming",
      text: normalized.teamStageBreakdown?.norming,
    },
    {
      fieldKey: "teamStagePerforming",
      text: normalized.teamStageBreakdown?.performing,
    },
  ];
  const informativeCandidates = candidates.filter(
    (candidate) => candidate?.text && !isMissingExtractedText(candidate.text),
  );
  if (!informativeCandidates.length) return false;
  if (shouldRequestCorePatternHydrationCleanup(normalized.corePatternBullets)) return true;
  return true;
}

function buildDashboardNarrativesCleanupCacheKey({
  corePatternBullets,
  strainQualitativeWriteups,
  feedbackGuideMatrix,
  overallStrainSummary,
  developmentExercises,
  spreadsheetFocuses,
  teamStageBreakdown,
  detectedType,
  reportFileName,
  reportId,
}) {
  const normalized = normalizeDashboardNarrativeCleanupInput({
    corePatternBullets,
    strainQualitativeWriteups,
    feedbackGuideMatrix,
    overallStrainSummary,
    developmentExercises,
    spreadsheetFocuses,
    teamStageBreakdown,
  });
  return JSON.stringify({
    detectedType: String(detectedType || ""),
    reportFileName: String(reportFileName || ""),
    reportId: String(reportId || ""),
    payload: normalized,
  });
}

function mergeDashboardNarrativeCleanupPayload(preferredPayload, fallbackPayload) {
  const preferred = normalizeDashboardNarrativeCleanupInput(preferredPayload);
  const fallback = normalizeDashboardNarrativeCleanupInput(fallbackPayload);
  const corePatternBullets = mergeCorePatternBullets(
    preferred.corePatternBullets,
    fallback.corePatternBullets,
  );

  const strainQualitativeWriteups = DASHBOARD_CLEANUP_STRAIN_CATEGORIES.map((category) => {
    const preferredRow = preferred.strainQualitativeWriteups.find(
      (row) => String(row?.category || "").toLowerCase() === String(category).toLowerCase(),
    );
    const fallbackRow = fallback.strainQualitativeWriteups.find(
      (row) => String(row?.category || "").toLowerCase() === String(category).toLowerCase(),
    );
    const preferredText = normalizeDashboardNarrativeCleanupText(preferredRow?.text, null);
    const fallbackText = normalizeDashboardNarrativeCleanupText(fallbackRow?.text, null);
    const resolvedText =
      (preferredText && !isMissingExtractedText(preferredText) ? preferredText : null) ||
      (fallbackText && !isMissingExtractedText(fallbackText) ? fallbackText : null) ||
      "Not detected in assigned PDF.";
    return { category, text: resolvedText };
  });

  const mergedDevelopmentRows = [];
  const developmentLength = Math.max(
    preferred.developmentExercises.length,
    fallback.developmentExercises.length,
    1,
  );
  for (let index = 0; index < developmentLength; index += 1) {
    const preferredRow = preferred.developmentExercises[index] || null;
    const fallbackRow = fallback.developmentExercises[index] || null;
    const preferredText = normalizeDashboardNarrativeCleanupText(preferredRow?.text, null);
    const fallbackText = normalizeDashboardNarrativeCleanupText(fallbackRow?.text, null);
    const resolvedText =
      (preferredText && !isMissingExtractedText(preferredText) ? preferredText : null) ||
      (fallbackText && !isMissingExtractedText(fallbackText) ? fallbackText : null) ||
      "Not detected in assigned PDF.";
    mergedDevelopmentRows.push({
      title:
        normalizeDashboardNarrativeCleanupText(preferredRow?.title, null) ||
        normalizeDashboardNarrativeCleanupText(fallbackRow?.title, null) ||
        `Exercise ${index + 1}`,
      text: resolvedText,
    });
  }
  const developmentExercises = normalizeDevelopmentExerciseRows(mergedDevelopmentRows, 12);

  const mergeInstinctGoal = (key) => {
    const preferredText = normalizeDashboardNarrativeCleanupText(
      preferred.spreadsheetFocuses?.instinctGoals?.[key],
      null,
    );
    const fallbackText = normalizeDashboardNarrativeCleanupText(
      fallback.spreadsheetFocuses?.instinctGoals?.[key],
      null,
    );
    return (
      (preferredText && !isMissingExtractedText(preferredText) ? preferredText : null) ||
      (fallbackText && !isMissingExtractedText(fallbackText) ? fallbackText : null) ||
      "Not detected in assigned PDF."
    );
  };

  const preferredDevelopingAsCopy = normalizeDashboardNarrativeCleanupText(
    preferred.spreadsheetFocuses?.developingAsCopy,
    null,
  );
  const fallbackDevelopingAsCopy = normalizeDashboardNarrativeCleanupText(
    fallback.spreadsheetFocuses?.developingAsCopy,
    null,
  );
  const developingAsCopy =
    (preferredDevelopingAsCopy && !isMissingExtractedText(preferredDevelopingAsCopy)
      ? preferredDevelopingAsCopy
      : null) ||
    (fallbackDevelopingAsCopy && !isMissingExtractedText(fallbackDevelopingAsCopy)
      ? fallbackDevelopingAsCopy
      : null) ||
    "Not detected in assigned PDF.";

  const preferredBullets = Array.from(
    new Set(
      (Array.isArray(preferred.spreadsheetFocuses?.developingAsBullets)
        ? preferred.spreadsheetFocuses.developingAsBullets
        : []
      )
        .map((row) => normalizeDashboardNarrativeCleanupText(row, null))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 12);
  const fallbackBullets = Array.from(
    new Set(
      (Array.isArray(fallback.spreadsheetFocuses?.developingAsBullets)
        ? fallback.spreadsheetFocuses.developingAsBullets
        : []
      )
        .map((row) => normalizeDashboardNarrativeCleanupText(row, null))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 12);
  let developingAsBullets = preferredBullets.length ? preferredBullets : fallbackBullets;
  if (!developingAsBullets.length) {
    developingAsBullets = extractNarrativeBulletItems(developingAsCopy, 12)
      .map((row) => normalizeDashboardNarrativeCleanupText(row, null))
      .filter(Boolean)
      .filter((row) => !isMissingExtractedText(row))
      .slice(0, 12);
  }
  if (!developingAsBullets.length) {
    developingAsBullets = ["Not detected in assigned PDF."];
  }

  const mergeSimpleTextField = (path) => {
    const preferredText = normalizeDashboardNarrativeCleanupText(
      preferred?.spreadsheetFocuses?.[path],
      null,
    );
    const fallbackText = normalizeDashboardNarrativeCleanupText(
      fallback?.spreadsheetFocuses?.[path],
      null,
    );
    return (
      (preferredText && !isMissingExtractedText(preferredText) ? preferredText : null) ||
      (fallbackText && !isMissingExtractedText(fallbackText) ? fallbackText : null) ||
      "Not detected in assigned PDF."
    );
  };

  const mergeSimpleTopLevelTextField = (key) => {
    const preferredText = normalizeDashboardNarrativeCleanupText(preferred?.[key], null);
    const fallbackText = normalizeDashboardNarrativeCleanupText(fallback?.[key], null);
    return (
      (preferredText && !isMissingExtractedText(preferredText) ? preferredText : null) ||
      (fallbackText && !isMissingExtractedText(fallbackText) ? fallbackText : null) ||
      "Not detected in assigned PDF."
    );
  };

  const bodyLanguageRows = Array.from(
    new Set(
      [
        ...(Array.isArray(preferred.spreadsheetFocuses?.bodyLanguageRows)
          ? preferred.spreadsheetFocuses.bodyLanguageRows
          : []),
        ...(Array.isArray(fallback.spreadsheetFocuses?.bodyLanguageRows)
          ? fallback.spreadsheetFocuses.bodyLanguageRows
          : []),
      ]
        .map((row) => normalizeDashboardNarrativeCleanupText(row, null))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 10);

  const conflictTriggeredBullets = Array.from(
    new Set(
      [
        ...(Array.isArray(preferred.spreadsheetFocuses?.conflictTriggeredBullets)
          ? preferred.spreadsheetFocuses.conflictTriggeredBullets
          : []),
        ...(Array.isArray(fallback.spreadsheetFocuses?.conflictTriggeredBullets)
          ? fallback.spreadsheetFocuses.conflictTriggeredBullets
          : []),
      ]
        .map((row) => normalizeDashboardNarrativeCleanupText(row, null))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 16);

  const feedbackGuideMatrix = normalizeDashboardNarrativeCleanupFeedbackRows(
    preferred.feedbackGuideMatrix.length ? preferred.feedbackGuideMatrix : fallback.feedbackGuideMatrix,
    9,
  );

  const teamStageBreakdown = {
    forming: (
      (normalizeDashboardNarrativeCleanupText(preferred?.teamStageBreakdown?.forming, null) &&
      !isMissingExtractedText(preferred?.teamStageBreakdown?.forming)
        ? normalizeDashboardNarrativeCleanupText(preferred?.teamStageBreakdown?.forming, null)
        : null) ||
      (normalizeDashboardNarrativeCleanupText(fallback?.teamStageBreakdown?.forming, null) &&
      !isMissingExtractedText(fallback?.teamStageBreakdown?.forming)
        ? normalizeDashboardNarrativeCleanupText(fallback?.teamStageBreakdown?.forming, null)
        : null) ||
      "Not detected in assigned PDF."
    ),
    storming: (
      (normalizeDashboardNarrativeCleanupText(preferred?.teamStageBreakdown?.storming, null) &&
      !isMissingExtractedText(preferred?.teamStageBreakdown?.storming)
        ? normalizeDashboardNarrativeCleanupText(preferred?.teamStageBreakdown?.storming, null)
        : null) ||
      (normalizeDashboardNarrativeCleanupText(fallback?.teamStageBreakdown?.storming, null) &&
      !isMissingExtractedText(fallback?.teamStageBreakdown?.storming)
        ? normalizeDashboardNarrativeCleanupText(fallback?.teamStageBreakdown?.storming, null)
        : null) ||
      "Not detected in assigned PDF."
    ),
    norming: (
      (normalizeDashboardNarrativeCleanupText(preferred?.teamStageBreakdown?.norming, null) &&
      !isMissingExtractedText(preferred?.teamStageBreakdown?.norming)
        ? normalizeDashboardNarrativeCleanupText(preferred?.teamStageBreakdown?.norming, null)
        : null) ||
      (normalizeDashboardNarrativeCleanupText(fallback?.teamStageBreakdown?.norming, null) &&
      !isMissingExtractedText(fallback?.teamStageBreakdown?.norming)
        ? normalizeDashboardNarrativeCleanupText(fallback?.teamStageBreakdown?.norming, null)
        : null) ||
      "Not detected in assigned PDF."
    ),
    performing: (
      (normalizeDashboardNarrativeCleanupText(preferred?.teamStageBreakdown?.performing, null) &&
      !isMissingExtractedText(preferred?.teamStageBreakdown?.performing)
        ? normalizeDashboardNarrativeCleanupText(preferred?.teamStageBreakdown?.performing, null)
        : null) ||
      (normalizeDashboardNarrativeCleanupText(fallback?.teamStageBreakdown?.performing, null) &&
      !isMissingExtractedText(fallback?.teamStageBreakdown?.performing)
        ? normalizeDashboardNarrativeCleanupText(fallback?.teamStageBreakdown?.performing, null)
        : null) ||
      "Not detected in assigned PDF."
    ),
  };

  return {
    corePatternBullets,
    strainQualitativeWriteups,
    feedbackGuideMatrix,
    overallStrainSummary: mergeSimpleTopLevelTextField("overallStrainSummary"),
    developmentExercises: developmentExercises.length
      ? developmentExercises
      : [{ title: "Exercise 1", text: "Not detected in assigned PDF." }],
    spreadsheetFocuses: {
      motivationSummary: mergeSimpleTextField("motivationSummary"),
      instinctGoals: {
        selfPres: mergeInstinctGoal("selfPres"),
        social: mergeInstinctGoal("social"),
        oneOnOne: mergeInstinctGoal("oneOnOne"),
      },
      developingAsCopy,
      developingAsBullets,
      bodyLanguageRows: bodyLanguageRows.length ? bodyLanguageRows : ["Not detected in assigned PDF."],
      conflictResponseCopy: mergeSimpleTextField("conflictResponseCopy"),
      conflictTriggeredCopy: mergeSimpleTextField("conflictTriggeredCopy"),
      conflictTriggeredBullets: conflictTriggeredBullets.length
        ? conflictTriggeredBullets
        : ["Not detected in assigned PDF."],
      centeredDecisionCopy: mergeSimpleTextField("centeredDecisionCopy"),
      decisionImpactCopy: mergeSimpleTextField("decisionImpactCopy"),
      decisionStrainCopy: mergeSimpleTextField("decisionStrainCopy"),
      strategicLeadershipCopy: mergeSimpleTextField("strategicLeadershipCopy"),
      teamImpactCopy: mergeSimpleTextField("teamImpactCopy"),
      interdependenceCopy: mergeSimpleTextField("interdependenceCopy"),
      coachingRelationshipCopy: mergeSimpleTextField("coachingRelationshipCopy"),
    },
    teamStageBreakdown,
  };
}

function resolveDashboardNarrativeCleanupPayload(value) {
  return normalizeDashboardNarrativeCleanupInput(value);
}

async function hydrateDashboardNarrativesWithLlmCleanup({
  corePatternBullets,
  strainQualitativeWriteups,
  feedbackGuideMatrix,
  overallStrainSummary,
  developmentExercises,
  spreadsheetFocuses,
  teamStageBreakdown,
  detectedType,
  reportFileName,
  reportId,
  ingestionToken,
}) {
  const normalizedPayload = normalizeDashboardNarrativeCleanupInput({
    corePatternBullets,
    strainQualitativeWriteups,
    feedbackGuideMatrix,
    overallStrainSummary,
    developmentExercises,
    spreadsheetFocuses,
    teamStageBreakdown,
  });
  const shouldCleanup = shouldRequestDashboardNarrativesCleanup(normalizedPayload);
  if (!shouldCleanup) {
    return normalizedPayload;
  }
  if (typeof fetch !== "function") return normalizedPayload;

  const cacheKey = buildDashboardNarrativesCleanupCacheKey({
    corePatternBullets: normalizedPayload.corePatternBullets,
    strainQualitativeWriteups: normalizedPayload.strainQualitativeWriteups,
    feedbackGuideMatrix: normalizedPayload.feedbackGuideMatrix,
    overallStrainSummary: normalizedPayload.overallStrainSummary,
    developmentExercises: normalizedPayload.developmentExercises,
    spreadsheetFocuses: normalizedPayload.spreadsheetFocuses,
    teamStageBreakdown: normalizedPayload.teamStageBreakdown,
    detectedType,
    reportFileName,
    reportId,
  });
  if (DASHBOARD_COPY_HYDRATION_CACHE.has(cacheKey)) {
    console.log("[report-ingest] Reusing cached dashboard narrative LLM cleanup result", {
      ingestionToken,
      reportId: reportId || null,
      reportFileName: reportFileName || null,
    });
    return mergeDashboardNarrativeCleanupPayload(
      DASHBOARD_COPY_HYDRATION_CACHE.get(cacheKey),
      normalizedPayload,
    );
  }

  const requestBody = {
    detectedType: detectedType || null,
    reportFileName: reportFileName || null,
    reportId: reportId || null,
    ...normalizedPayload,
  };

  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => {
    abortController.abort(new Error("dashboard narrative llm cleanup timeout"));
  }, DASHBOARD_COPY_HYDRATION_LLM_TIMEOUT_MS);

  try {
    console.log("[report-ingest] Running dashboard narrative LLM hydration cleanup", {
      ingestionToken,
      detectedType: detectedType || null,
      reportId: reportId || null,
      reportFileName: reportFileName || null,
      route: DASHBOARD_COPY_HYDRATION_CLEANUP_ROUTE,
    });
    const response = await fetch(DASHBOARD_COPY_HYDRATION_CLEANUP_ROUTE, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });
    if (!response.ok) {
      const failureText = await response.text().catch(() => "");
      console.log("[report-ingest] Dashboard narrative LLM cleanup route failed", {
        ingestionToken,
        status: response.status,
        statusText: response.statusText,
        responseTextPreview: String(failureText || "").slice(0, 400),
      });
      DASHBOARD_COPY_HYDRATION_CACHE.set(cacheKey, normalizedPayload);
      return normalizedPayload;
    }

    const payload = await response.json().catch(() => ({}));
    const cleanedPayload = resolveDashboardNarrativeCleanupPayload(payload);
    const mergedPayload = mergeDashboardNarrativeCleanupPayload(cleanedPayload, normalizedPayload);
    DASHBOARD_COPY_HYDRATION_CACHE.set(cacheKey, mergedPayload);
    console.log("[report-ingest] Dashboard narrative LLM hydration cleanup complete", {
      ingestionToken,
      reportId: reportId || null,
      reportFileName: reportFileName || null,
      usedFallback: payload?.success === false,
      model: payload?.model || null,
    });
    return mergedPayload;
  } catch (error) {
    console.log("[report-ingest] Dashboard narrative LLM cleanup request failed; using deterministic copy", {
      ingestionToken,
      reportId: reportId || null,
      reportFileName: reportFileName || null,
      details: String(error?.message || "Unknown dashboard narrative cleanup error"),
      stack: error?.stack,
    });
    DASHBOARD_COPY_HYDRATION_CACHE.set(cacheKey, normalizedPayload);
    return normalizedPayload;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function extractCorePatternSectionByAnchors(text, startAnchor, endAnchors = []) {
  const source = normalizeExtractedText(text || "");
  if (!source) return "";
  const startMatch = findInstructionAnchorMatch(source, startAnchor, { startIndex: 0, preferHeading: true }) ||
    findInstructionAnchorMatch(source, startAnchor, { startIndex: 0, preferHeading: false });
  if (!startMatch) return "";
  const startIndex = startMatch.index + startMatch.length;
  let endIndex = source.length;
  const boundaries = Array.isArray(endAnchors) ? endAnchors : [];
  boundaries.forEach((anchor) => {
    const match = findInstructionAnchorMatch(source, anchor, { startIndex, preferHeading: true }) ||
      findInstructionAnchorMatch(source, anchor, { startIndex, preferHeading: false });
    if (!match) return;
    if (match.index >= startIndex && match.index < endIndex) {
      endIndex = match.index;
    }
  });
  return cleanPdfExtractedValue(source.slice(startIndex, endIndex)) || "";
}

function extractCorePatternBulletsFromText(text) {
  const actionText = extractCorePatternSectionByAnchors(text, "Typical Action Patterns", [
    "Typical Thinking Patterns",
    "Typical Feeling Patterns",
    "Blind Spots",
    "Worldview",
    "World View",
  ]);
  const thinkingText = extractCorePatternSectionByAnchors(text, "Typical Thinking Patterns", [
    "Typical Feeling Patterns",
    "Blind Spots",
    "Worldview",
    "World View",
  ]);
  const feelingText = extractCorePatternSectionByAnchors(text, "Typical Feeling Patterns", [
    "Typical Thinking Patterns",
    "Typical Action Patterns",
    "Blind Spots",
    "Worldview",
    "World View",
    "Detailed Enneagram Description",
    "Your main Enneagram style",
    "Focus of Attention",
    "Core Fear",
    "DEVELOPMENT EXERCISE",
  ]);

  return normalizeCorePatternBullets([
    { key: "action", label: "Typical Action Patterns", text: actionText || null },
    { key: "thinking", label: "Typical Thinking Patterns", text: thinkingText || null },
    { key: "feeling", label: "Typical Feeling Patterns", text: feelingText || null },
  ]);
}

function extractCorePatternLinesFromText(text) {
  const bullets = extractCorePatternBulletsFromText(text);
  return bullets
    .map((row) => sanitizeSnippet(row?.text, null))
    .filter(Boolean)
    .filter((line) => !isMissingExtractedText(line));
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
const REPORT_TYPE_PAGE_THRESHOLDS = Object.freeze({
  STD: 16,
  PRO: 42,
});

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

function inferAssignedReportTypeFromFileName(reportFileName) {
  const normalized = String(reportFileName || "").toUpperCase();
  if (!normalized) return null;
  if (/\bSTD\b/.test(normalized) || /\bSTANDARD\b/.test(normalized)) return "STD";
  if (/\bPRO\b/.test(normalized) || /\bPROFESSIONAL\b/.test(normalized)) return "PRO";
  return null;
}

function resolveAssignedReportType({
  reportFileName,
  parseDiagnostics,
  parsedProfile,
  reportContentText,
  likelyProReport,
}) {
  const inferredFromFileName = inferAssignedReportTypeFromFileName(reportFileName);
  if (inferredFromFileName) return inferredFromFileName;

  const minExpectedPages = Number(parseDiagnostics?.extraction?.minExpectedPages || 0);
  if (Number.isFinite(minExpectedPages) && minExpectedPages > 0) {
    if (minExpectedPages <= REPORT_TYPE_PAGE_THRESHOLDS.STD) return "STD";
    if (minExpectedPages >= REPORT_TYPE_PAGE_THRESHOLDS.PRO) return "PRO";
  }

  const proSignal = likelyProReport === true
    ? true
    : isLikelyProReport({ reportFileName, parsedProfile, reportContentText });
  return proSignal ? "PRO" : null;
}

function supportsIntegrationLevelForAssignedReport(input) {
  return resolveAssignedReportType(input) !== "STD";
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
  if (normalized === "HIGH") return 100;
  if (normalized === "MEDIUM" || normalized === "MODERATE") return 50;
  if (normalized === "LOW") return 0;
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
  const rawValue = String(value || "");
  const rawHasControlNoise = /[\u0000-\u001F\u007F-\u009F]/.test(rawValue);
  const wordGapMarker = "\u0000";
  let cleaned = rawValue
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/[ \t\u00A0\u2000-\u200B\u202F\u205F\u3000]{2,}/g, wordGapMarker)
    .replace(/\s+/g, " ")
    // OCR occasionally injects a bogus "C'" token ahead of sentence starts.
    .replace(/(^|[.!?]\s+)\s*C['’`´]\s*(?=[A-Z])/g, "$1")
    .replace(/^C['’`´]\s*(?=[A-Z])/, "")
    .trim();
  if (!cleaned) return fallback;

  const shortWords = new Set([
    "a", "am", "an", "as", "at",
    "be", "by",
    "do",
    "go",
    "he", "her", "his",
    "i", "if", "in", "is", "it",
    "me", "my",
    "no", "not",
    "of", "on", "or", "our",
    "so",
    "the", "to", "too",
    "up", "us",
    "we",
    "you",
  ]);
  const commonOcrBigramWords = new Set([
    "of",
    "to",
    "in",
    "is",
    "it",
    "on",
    "as",
    "at",
    "by",
    "or",
    "an",
    "if",
    "up",
    "we",
    "us",
    "my",
    "so",
  ]);

  // Repair hard OCR splits such as "d i f f e r e n c e".
  cleaned = cleaned.replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (match) => {
    const source = String(match || "");
    const hasExplicitWordGap = source.includes(wordGapMarker);
    const parts = String(match || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return match;
    // If OCR removed all word boundaries for a long fragment, preserve spacing
    // instead of collapsing into a single unreadable mega-token.
    if (!hasExplicitWordGap && source.length >= 48) {
      return source.replace(/\s+/g, " ").trim();
    }
    const first = String(parts[0] || "");
    const firstLower = first.toLowerCase();
    if (parts.length >= 4 && first === firstLower && shortWords.has(firstLower)) {
      return `${first} ${parts.slice(1).join("")}`;
    }
    return parts.join("");
  });

  const wordBoundaryLexicon =
    sanitizeSnippet.__wordBoundaryLexicon ||
    (sanitizeSnippet.__wordBoundaryLexicon = new Set([
      "a", "about", "action", "active", "adaptability", "alignment", "aliveness", "ambiguous", "am", "an", "and", "anxiety",
      "are", "as", "assertive", "at", "attention", "authenticity", "awareness",
      "balance", "balanced", "be", "because", "been", "being", "belonging", "best", "blind", "body", "boundaries", "breakdown",
      "by",
      "calm", "can", "care", "center", "centered", "centre", "challenge", "charisma", "clarity", "close", "coaching", "collaboration",
      "collaborative", "communication", "compassion", "conflict", "connection", "control", "cope", "core", "courage", "creative",
      "creativity",
      "decision", "decisive", "depth", "development", "did", "difficult", "direction", "discipline", "do", "does", "drain", "drive",
      "driven", "dynamic", "dynamics",
      "emotional", "empathy", "encouraging", "energy", "enneagram", "environment", "environmental", "example", "expression",
      "failure", "fear", "feeling", "field", "focus", "for", "forming", "framework", "free", "from",
      "gifts", "go", "goal", "goals", "good", "grounded", "growth", "guidance",
      "happen", "happiness", "hard", "has", "have", "he", "heart", "help", "helper", "her", "high", "him", "his", "how",
      "i", "if", "impact", "in", "influence", "insight", "instinct", "integration", "intelligence", "interdependence", "interpersonal",
      "into", "is", "it", "its",
      "just", "justice",
      "kind", "know",
      "leadership", "level", "life", "line", "low",
      "make", "main", "may", "me", "medium", "meta", "moderate", "moment", "momentum", "more", "most", "motivation", "my",
      "need", "needs", "no", "norming", "not",
      "of", "on", "one", "only", "or", "our", "out", "overall", "own",
      "pace", "pattern", "patterns", "people", "performing", "personal", "physical", "place", "point", "points", "possession", "power",
      "pressure", "profile", "protective",
      "quality",
      "reactive", "reflection", "regulation", "relationship", "relationships", "release", "reliable", "report", "results", "risk", "role",
      "self", "selftalk", "so", "social", "solutions", "some", "stage", "stages", "steady", "strategic", "strength", "strengths",
      "stretch", "strong", "style", "subtype", "support", "survive",
      "take", "team", "than", "that", "the", "their", "them", "then", "there", "these", "they", "things", "this", "those", "thinking",
      "through", "to", "tough", "trait", "traits", "trigger", "triggers", "true", "type", "types",
      "under", "understanding", "unjust", "up", "us",
      "vice", "vices", "vocational", "vulnerability",
      "we", "weakness", "wellbeing", "what", "when", "which", "who", "with", "without", "wing", "world", "worldview",
      "able", "acting", "all", "any", "are", "ball", "begin", "better", "body", "choice", "choose", "devoted", "direct",
      "dislike", "dropping", "first", "important", "independence", "instincts", "intense", "issue", "language", "mainly",
      "micromanage", "nature", "nothing", "often", "project", "quickly", "second", "seems", "sort", "step", "subject",
      "tall", "tend", "toughen", "unless", "usually", "want", "way", "whenever", "words", "work", "would",
      "mentally", "assess", "either", "weak", "treat", "according", "assessment", "also", "become", "makes", "tendency",
      "before", "reacting", "responding", "signal",
      "you", "your", "yourself", "myself", "ourselves", "themselves", "himself", "herself", "itself",
    ]));

  function toLexiconSegments(token, options = {}) {
    const sourceToken = String(token || "");
    if (!/^[A-Za-z]+$/.test(sourceToken)) return null;
    const lowerToken = sourceToken.toLowerCase();
    if (wordBoundaryLexicon.has(lowerToken)) return null;
    const tokenLength = lowerToken.length;
    const fromMergedWords = Boolean(options.fromMergedWords);
    if (!fromMergedWords && tokenLength < 6) return null;
    const allowShortStarter = /^(a|i)[a-z]{4,}$/.test(lowerToken);
    if (!fromMergedWords && tokenLength < 9 && !allowShortStarter) return null;

    const maxPieceLength = Math.min(20, tokenLength);
    const dp = Array(tokenLength + 1).fill(null);
    dp[0] = [];
    for (let index = 0; index < tokenLength; index += 1) {
      const existing = dp[index];
      if (!existing) continue;
      for (let end = index + 1; end <= Math.min(tokenLength, index + maxPieceLength); end += 1) {
        const piece = lowerToken.slice(index, end);
        if (!wordBoundaryLexicon.has(piece)) continue;
        if (piece.length === 1 && piece !== "a" && piece !== "i") continue;
        const candidate = existing.concat(piece);
        const current = dp[end];
        if (!current || candidate.length < current.length) {
          dp[end] = candidate;
          continue;
        }
        if (candidate.length === current.length) {
          const candidateLongPieces = candidate.filter((part) => part.length >= 4).length;
          const currentLongPieces = current.filter((part) => part.length >= 4).length;
          if (candidateLongPieces > currentLongPieces) {
            dp[end] = candidate;
          }
        }
      }
    }

    const parts = dp[tokenLength];
    if (!parts || parts.length < 2) return null;
    if (!parts.some((part) => part.length >= 4)) return null;
    if (!fromMergedWords && tokenLength < 9) {
      if (!(parts.length === 2 && (parts[0] === "a" || parts[0] === "i") && parts[1].length >= 4)) {
        return null;
      }
    }
    if (parts.some((part) => part.length === 1 && part !== "a" && part !== "i")) {
      return null;
    }
    return parts.join(" ");
  }

  function applyCasingFromSource(sourceToken, segmentedValue) {
    const normalized = String(segmentedValue || "").toLowerCase();
    if (!normalized) return sourceToken;
    if (/^[A-Z]+$/.test(sourceToken)) return normalized.toUpperCase();
    if (/^[A-Z][a-z]+$/.test(sourceToken)) {
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
    if (/^[A-Z]/.test(sourceToken) && sourceToken.slice(1) === sourceToken.slice(1).toLowerCase()) {
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
    return normalized;
  }

  function toApproximateLexiconSegments(token) {
    const sourceToken = String(token || "");
    if (!/^[A-Za-z]+$/.test(sourceToken)) return null;
    const lowerToken = sourceToken.toLowerCase();
    const tokenLength = lowerToken.length;
    if (tokenLength < 7) return null;
    const maxPieceLength = Math.min(20, tokenLength);
    const dp = Array(tokenLength + 1).fill(null);
    dp[0] = { score: 0, parts: [], knownChars: 0 };

    for (let index = 0; index < tokenLength; index += 1) {
      const existing = dp[index];
      if (!existing) continue;
      for (let end = index + 1; end <= Math.min(tokenLength, index + maxPieceLength); end += 1) {
        const piece = lowerToken.slice(index, end);
        const known = wordBoundaryLexicon.has(piece);
        if (known && piece.length === 1 && piece !== "a" && piece !== "i") continue;
        if (!known && (piece.length < 3 || piece.length > 10)) continue;

        let score = existing.score;
        if (known) {
          score -= piece.length >= 4 ? 12 + piece.length : 3;
        } else {
          score += 18 + (piece.length * 2);
          if (index === 0 || end === tokenLength) score += 10;
        }

        const candidate = {
          score,
          parts: existing.parts.concat(piece),
          knownChars: existing.knownChars + (known ? piece.length : 0),
        };
        const current = dp[end];
        if (!current || candidate.score < current.score) {
          dp[end] = candidate;
          continue;
        }
        if (candidate.score === current.score && candidate.parts.length < current.parts.length) {
          dp[end] = candidate;
        }
      }
    }

    const result = dp[tokenLength];
    if (!result || result.parts.length < 2) return null;
    if (result.parts.some((part) => part.length === 1 && part !== "a" && part !== "i")) return null;
    if (result.parts.some((part) => !wordBoundaryLexicon.has(part) && part.length > 7)) return null;
    if (result.knownChars / tokenLength < 0.6) return null;
    return result.parts.join(" ");
  }

  function repairLongLetterRuns(value) {
    return String(value || "").replace(/\b(?:[A-Za-z]\s+){6,}[A-Za-z]\b/g, (match) => {
      const letters = String(match || "").trim().split(/\s+/).filter((token) => /^[A-Za-z]$/.test(token));
      if (letters.length < 7) return match;
      const merged = letters.join("");
      const segmented =
        toLexiconSegments(merged, { fromMergedWords: true }) ||
        toApproximateLexiconSegments(merged);
      if (!segmented) return match;
      return applyCasingFromSource(merged, segmented);
    });
  }

  function repairWordBoundaryGaps(value) {
    const parts = String(value || "").match(/[A-Za-z]+|[^A-Za-z]+/g) || [];
    const repaired = [];
    let cursor = 0;

    while (cursor < parts.length) {
      const current = parts[cursor];
      if (!/^[A-Za-z]+$/.test(current)) {
        repaired.push(current);
        cursor += 1;
        continue;
      }

      let mergedApplied = false;
      for (let windowSize = 4; windowSize >= 2; windowSize -= 1) {
        let endIndex = cursor;
        const words = [current];
        let validWindow = true;
        for (let offset = 1; offset < windowSize; offset += 1) {
          const separator = parts[endIndex + 1];
          const nextWord = parts[endIndex + 2];
          if (separator !== " " || !/^[A-Za-z]+$/.test(nextWord || "")) {
            validWindow = false;
            break;
          }
          words.push(nextWord);
          endIndex += 2;
        }
        if (!validWindow) continue;
        const joined = words.join("");
        const unknownWordCount = words.filter((word) => !wordBoundaryLexicon.has(String(word || "").toLowerCase())).length;
        if (!unknownWordCount) continue;
        const hasTinyUnknownFragment = words.some((word) => {
          const lowerWord = String(word || "").toLowerCase();
          return word.length <= 2 && !shortWords.has(lowerWord);
        });
        const hasShortUnknownFragment = words.some((word) => {
          const lowerWord = String(word || "").toLowerCase();
          return word.length <= 3 && !wordBoundaryLexicon.has(lowerWord);
        });
        const hasUnknownPairCompression = windowSize === 2 && unknownWordCount === 2 && joined.length >= 10;
        const hasSuspiciousSplit = hasTinyUnknownFragment || hasShortUnknownFragment || hasUnknownPairCompression;
        if (!hasSuspiciousSplit) continue;
        const merged =
          toLexiconSegments(joined, { fromMergedWords: true }) ||
          (joined.length >= 16 && unknownWordCount >= 2 ? toApproximateLexiconSegments(joined) : null);
        if (!merged) continue;
        repaired.push(applyCasingFromSource(joined, merged));
        cursor = endIndex + 1;
        mergedApplied = true;
        break;
      }
      if (mergedApplied) continue;

      const singleTokenRepair =
        toLexiconSegments(current, { fromMergedWords: false }) ||
        (current.length >= 24 ? toApproximateLexiconSegments(current) : null);
      if (singleTokenRepair) {
        repaired.push(applyCasingFromSource(current, singleTokenRepair));
      } else {
        repaired.push(current);
      }
      cursor += 1;
    }

    return repaired.join("");
  }

  cleaned = repairLongLetterRuns(cleaned);

  // Repair isolated 2-letter OCR splits such as "o f" -> "of" without
  // collapsing longer natural short-word sequences.
  cleaned = cleaned.replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, (match, left, right) => {
    const pair = `${String(left || "")}${String(right || "")}`.toLowerCase();
    if (!commonOcrBigramWords.has(pair)) return match;
    return `${left}${right}`;
  });

  // Repair 3-part OCR splits such as "sur v ive" and "di ff erence".
  cleaned = cleaned.replace(/\b([A-Za-z]{1,3})\s+([A-Za-z]{1,2})\s+([A-Za-z]{3,})\b/g, (match, partA, partB, partC) => {
    const lowerA = String(partA || "").toLowerCase();
    const lowerB = String(partB || "").toLowerCase();
    if (shortWords.has(lowerA) || shortWords.has(lowerB)) return match;
    return `${partA}${partB}${partC}`;
  });

  // Repair 2-part OCR splits such as "di fficult" while preserving short-word phrases.
  cleaned = cleaned.replace(/(^|[^A-Za-z'’`´-])([A-Za-z]{1,2})\s+([A-Za-z]{4,})\b/g, (match, lead, prefix, suffix) => {
    const lowerPrefix = String(prefix || "").toLowerCase();
    if (shortWords.has(lowerPrefix)) return match;
    return `${lead}${prefix}${suffix}`;
  });

  // Repair frequent OCR fragment "G i s" -> "G is".
  cleaned = cleaned.replace(/\b([A-Za-z])\s+i\s+s\b/g, "$1 is");

  cleaned = repairWordBoundaryGaps(cleaned);

  // Recover full run-on OCR rows that lost most spaces altogether.
  cleaned = cleaned.replace(/\b[A-Za-z]{28,}\b/g, (token) => {
    const segmented =
      toLexiconSegments(token, { fromMergedWords: true }) ||
      toApproximateLexiconSegments(token);
    if (!segmented) return token;
    return applyCasingFromSource(token, segmented);
  });

  cleaned = cleaned
    .replace(/\b(?:Page|Pg\.?)\s*\d(?:\s*\d){0,2}\s*(?:of|\/)\s*\d(?:\s*\d){0,2}\b/gi, " ")
    .replace(/\b(?:Page|Pg\.?)\s*\d(?:\s*\d){0,2}\b/gi, " ")
    .replace(/\[\s*Page\s*\d{1,3}\s*\]/gi, " ")
    .replace(/\bPage\s*\d{1,3}\s+Page\s*\d{1,3}\b/gi, " ")
    .replace(/\b\d(?:\s*\d){0,2}\s*(?:of|\/)\s*\d(?:\s*\d){0,2}\b(?=\s*(?:$|STRICTLY|CONFIDENTIAL|COPYRIGHT|Integrative|Enneagram|Ben\s*Russell))/gi, " ")
    .replace(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\s*20\d{2}\s*\[\s*ENGLISH\s*\]/gi, " ")
    .replace(/\bSTRICTLY\s*CONFIDENTIAL(?:\s+INDIVIDUAL)?(?:\s+PROFESSIONAL)?(?:\s+Enneagram\s*Report)?\b/gi, " ")
    .replace(/\bCopyright\s*\d{2,4}\s*[-–]\s*\d{2,4}\b/gi, " ")
    .replace(/\bIntegrative\s*Enneagram(?:\s*Solutions)?(?:\s*Ben\s*Russell)?\b/gi, " ")
    .replace(/(?:[^\w\s.,;:!?'"()\-–—•●▪◦]{1,2}\s*){8,}/g, " ")
    .replace(/\u0000/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return fallback;
  const normalizedForNoise = String(cleaned || "").replace(/\s+/g, " ").trim();
  const noiseTokens = normalizedForNoise
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const cleanedToken = String(token || "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
      if (/[A-Za-z]/.test(cleanedToken)) return false;
      if (/^\d{1,4}$/.test(cleanedToken)) return false;
      if (/^[•●▪◦·\-–—.,;:!?'"()]+$/.test(token)) return false;
      if (/[^A-Za-z0-9.,;:!?'"()\-–—•●▪◦]/.test(token)) return true;
      return token.length <= 3;
    });
  const hasSymbolNoise = noiseTokens.length >= 8 && noiseTokens.length / Math.max(1, normalizedForNoise.split(/\s+/).filter(Boolean).length) >= 0.28;
  const hasRepeatedPageMarkers = /(?:\bPage\s*\d{1,3}\b\s*){2,}/i.test(normalizedForNoise);
  if (rawHasControlNoise && (hasSymbolNoise || hasRepeatedPageMarkers)) {
    return fallback == null ? "" : fallback;
  }
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

const META_MESSAGE_SHORT_WORDS = new Set([
  "a", "am", "an", "as", "at",
  "be", "by",
  "do",
  "go",
  "he", "her", "his",
  "i", "if", "in", "is", "it",
  "me", "my",
  "no", "not",
  "of", "on", "or", "our",
  "so",
  "the", "to", "too",
  "up", "us",
  "we",
  "you",
]);

function normalizeMetaMessageLetterSpacing(value) {
  let text = String(value || "");
  if (!text) return text;

  // Repair hard OCR splits such as "d i f f e r e n c e".
  text = text.replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (match) => {
    const parts = String(match || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return match;
    const first = String(parts[0] || "");
    const firstLower = first.toLowerCase();
    if (parts.length >= 4 && first === firstLower && META_MESSAGE_SHORT_WORDS.has(firstLower)) {
      return `${first} ${parts.slice(1).join("")}`;
    }
    return parts.join("");
  });

  // Repair 3-part splits such as "di ff erence" while avoiding common short-word phrases.
  text = text.replace(/\b([A-Za-z]{1,3})\s+([A-Za-z]{1,2})\s+([A-Za-z]{3,})\b/g, (match, partA, partB, partC) => {
    const lowerA = String(partA || "").toLowerCase();
    const lowerB = String(partB || "").toLowerCase();
    if (META_MESSAGE_SHORT_WORDS.has(lowerA) || META_MESSAGE_SHORT_WORDS.has(lowerB)) return match;
    return `${partA}${partB}${partC}`;
  });

  // Repair 2-part splits such as "di fference" while avoiding common two-letter words.
  text = text.replace(/\b([A-Za-z]{1,2})\s+([A-Za-z]{4,})\b/g, (match, prefix, suffix) => {
    const lowerPrefix = String(prefix || "").toLowerCase();
    if (META_MESSAGE_SHORT_WORDS.has(lowerPrefix)) return match;
    return `${prefix}${suffix}`;
  });

  return text;
}

function cleanupMetaQuote(value) {
  const cleaned = String(value || "")
    .replace(/^YOUR\s+META-MESSAGE\s*[:\-]?\s*/i, "")
    .replace(/\s+Communication\s*$/i, "");
  const normalized = normalizeMetaMessageLetterSpacing(cleaned);
  return sanitizeSnippet(normalized, null);
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

function extractPdfPageTextFromItems(items) {
  const tokens = (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const value = String(item?.str || "").trim();
      if (!value) return null;
      const transform = Array.isArray(item?.transform) ? item.transform : [];
      const x = Number(transform?.[4]);
      const y = Number(transform?.[5]);
      return {
        index,
        text: value,
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        hasEOL: Boolean(item?.hasEOL),
      };
    })
    .filter(Boolean);

  if (!tokens.length) return "";

  const out = [];
  let previousY = null;
  let previousX = null;
  tokens.forEach((token) => {
    const yJump = previousY == null ? 0 : Math.abs(token.y - previousY);
    const xReset = previousX == null ? false : token.x + 4 < previousX;
    if (out.length && (token?.hasEOL || yJump > 3.2 || (yJump > 1.6 && xReset))) {
      out.push("\n");
    } else if (out.length && out[out.length - 1] !== "\n") {
      out.push(" ");
    }
    out.push(token.text);
    previousY = token.y;
    previousX = token.x;
  });

  return out
    .join("")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/\([ \t]+/g, "(")
    .replace(/[ \t]+\)/g, ")")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    const pageText = extractPdfPageTextFromItems(content.items);
    console.log("[report-ingest] Extracted assigned PDF page text", {
      page,
      chars: String(pageText || "").length,
      itemCount: Array.isArray(content?.items) ? content.items.length : 0,
    });
    chunks.push(pageText);
  }

  return chunks.join("\n");
}

function buildProfileScoresFromTypeScores(typeScoresRaw) {
  if (!typeScoresRaw || typeof typeScoresRaw !== "object") return null;

  const mapped = {
    "1": toFiniteScoreOrNull(typeScoresRaw?.["1"] ?? typeScoresRaw?.type1),
    "2": toFiniteScoreOrNull(typeScoresRaw?.["2"] ?? typeScoresRaw?.type2),
    "3": toFiniteScoreOrNull(typeScoresRaw?.["3"] ?? typeScoresRaw?.type3),
    "4": toFiniteScoreOrNull(typeScoresRaw?.["4"] ?? typeScoresRaw?.type4),
    "5": toFiniteScoreOrNull(typeScoresRaw?.["5"] ?? typeScoresRaw?.type5),
    "6": toFiniteScoreOrNull(typeScoresRaw?.["6"] ?? typeScoresRaw?.type6),
    "7": toFiniteScoreOrNull(typeScoresRaw?.["7"] ?? typeScoresRaw?.type7),
    "8": toFiniteScoreOrNull(typeScoresRaw?.["8"] ?? typeScoresRaw?.type8),
    "9": toFiniteScoreOrNull(typeScoresRaw?.["9"] ?? typeScoresRaw?.type9),
  };

  const hasAnyFiniteScore = Object.values(mapped).some((value) => Number.isFinite(value));
  return hasAnyFiniteScore ? mapped : null;
}

function applyFallbackAssignedReportFromServerData(data) {
  const serverContext = data?.ingestedDashboardContext && typeof data.ingestedDashboardContext === "object"
    ? data.ingestedDashboardContext
    : {};
  const parsedProfile = data?.ingestedParsedProfile && typeof data.ingestedParsedProfile === "object"
    ? data.ingestedParsedProfile
    : {};
  const fallbackType =
    normalizeDetectedTypeCandidate(parsedProfile?.primaryType) ||
    normalizeDetectedTypeCandidate(serverContext?.detectedType) ||
    String(DEFAULT_EXAMPLE_REPORT_TYPE);
  const fallbackExample = REPORT_EXAMPLES?.[String(fallbackType || "")] || REPORT_EXAMPLES?.[DEFAULT_EXAMPLE_REPORT_TYPE] || {};

  const fallbackInstinct =
    instinctValueToLabel(parsedProfile?.instinctualVariant) ||
    instinctValueToLabel(serverContext?.instinct || serverContext?.instinctCode) ||
    fallbackExample?.instinct ||
    "N/A";
  const fallbackTypeName =
    sanitizeSnippet(parsedProfile?.typeName, "") ||
    sanitizeSnippet(serverContext?.typeName, "") ||
    sanitizeSnippet(fallbackExample?.typeName, "Not detected in assigned PDF.");
  const fallbackSubtypeKeyword =
    sanitizeSnippet(parsedProfile?.subtypeKeyword, "") ||
    sanitizeSnippet(serverContext?.subtypeKeyword, "") ||
    sanitizeSnippet(fallbackExample?.keyword, "Not detected in assigned PDF.");
  const fallbackConnectedLineA =
    sanitizeSnippet(parsedProfile?.connectedLineA, "") ||
    (parsedProfile?.arrowDynamics?.integration ? `Type ${parsedProfile.arrowDynamics.integration}` : "") ||
    sanitizeSnippet(fallbackExample?.release, "Type 5");
  const fallbackConnectedLineB =
    sanitizeSnippet(parsedProfile?.connectedLineB, "") ||
    (parsedProfile?.arrowDynamics?.disintegration ? `Type ${parsedProfile.arrowDynamics.disintegration}` : "") ||
    sanitizeSnippet(fallbackExample?.stretch, "Type 2");
  const fallbackIntegrationLevel =
    sanitizeSnippet(parsedProfile?.integrationLevel || parsedProfile?.integration, "") ||
    sanitizeSnippet(serverContext?.integrationLevel || serverContext?.integration, "") ||
    sanitizeSnippet(fallbackExample?.integration, "");

  const parsedDevelopmentExercises = Array.isArray(parsedProfile?.developmentExercises)
    ? parsedProfile.developmentExercises
        .map((row, index) => {
          if (row && typeof row === "object") {
            return {
              title: sanitizeSnippet(row?.title, `Exercise ${index + 1}`),
              text: sanitizeSnippet(row?.text || row?.guidance || row?.description, ""),
            };
          }
          return {
            title: `Exercise ${index + 1}`,
            text: sanitizeSnippet(row, ""),
          };
        })
        .filter((row) => Boolean(row?.text))
    : [];

  applyAssignedPdfReport({
    typeNumber: fallbackType,
    typeName: fallbackTypeName,
    instinct: fallbackInstinct,
    subtypeKeyword: fallbackSubtypeKeyword,
    connectedLineA: fallbackConnectedLineA,
    connectedLineB: fallbackConnectedLineB,
    integrationLevel: fallbackIntegrationLevel,
    supportsIntegrationLevel: parsedProfile?.supportsIntegrationLevel !== false,
    reportType: sanitizeSnippet(parsedProfile?.reportType, null),
    profileScores: buildProfileScoresFromTypeScores(parsedProfile?.typeScores || null),
    basicFear: parsedProfile?.coreFear || serverContext?.basicFear || null,
    basicDesire: parsedProfile?.coreDesire || serverContext?.basicDesire || null,
    passion: parsedProfile?.passion || serverContext?.passion || null,
    metaQuote: parsedProfile?.metaMessage || parsedProfile?.selfTalk || null,
    worldview: parsedProfile?.worldview || null,
    focus: parsedProfile?.focusOfAttention || parsedProfile?.focus || null,
    corePatternTitle: parsedProfile?.corePattern?.title || null,
    corePatternLines: Array.isArray(parsedProfile?.corePattern?.lines)
      ? parsedProfile.corePattern.lines
      : [],
    corePatternBullets:
      parsedProfile?.corePatternBullets ||
      parsedProfile?.corePattern?.bullets ||
      parsedProfile?.corePattern?.patterns ||
      [],
    reportSummary: parsedProfile?.reportSummary || null,
    clientName:
      parsedProfile?.clientName ||
      sanitizeSnippet(data?.clientName, null) ||
      sanitizeSnippet(serverContext?.clientName, null),
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
    insightTeamDynamics: parsedProfile?.insightTeamDynamics || null,
    insightDecisionFramework: parsedProfile?.insightDecisionFramework || null,
    insightStrategicLeadership: parsedProfile?.insightStrategicLeadership || null,
    insightCoachingRelationship: parsedProfile?.insightCoachingRelationship || null,
    insightFeedbackGuide: parsedProfile?.insightFeedbackGuide || null,
    insightComposite: parsedProfile?.insightComposite || null,
    feedbackGuideMatrix: Array.isArray(parsedProfile?.feedbackGuideMatrix) ? parsedProfile.feedbackGuideMatrix : [],
    strainQualitativeWriteups: Array.isArray(parsedProfile?.strainQualitativeWriteups) ? parsedProfile.strainQualitativeWriteups : [],
    overallStrainSummary:
      extractOverallStrainSummaryFromLlmProfile(parsedProfile) ||
      sanitizeSnippet(parsedProfile?.overallStrainSummary, null),
    developmentExercises: parsedDevelopmentExercises,
    spreadsheetFocuses:
      parsedProfile?.spreadsheetFocuses && typeof parsedProfile.spreadsheetFocuses === "object"
        ? parsedProfile.spreadsheetFocuses
        : {},
    teamStageBreakdown:
      parsedProfile?.teamStageBreakdown && typeof parsedProfile.teamStageBreakdown === "object"
        ? parsedProfile.teamStageBreakdown
        : {},
    strainScoresRaw: getParsedProfileStrainScores(parsedProfile) || null,
    interactionScores:
      parsedProfile?.interactionScores && typeof parsedProfile.interactionScores === "object"
        ? parsedProfile.interactionScores
        : null,
    dataQualityDiagnostics: buildDataQualityDiagnostics({
      parsedProfile,
      parseDiagnostics: data?.parseDiagnostics && typeof data.parseDiagnostics === "object" ? data.parseDiagnostics : null,
      feedbackGuideMatrix: Array.isArray(parsedProfile?.feedbackGuideMatrix) ? parsedProfile.feedbackGuideMatrix : [],
      strainQualitativeWriteups: Array.isArray(parsedProfile?.strainQualitativeWriteups) ? parsedProfile.strainQualitativeWriteups : [],
      developmentExercises: parsedDevelopmentExercises,
    }),
    hydrationSourceAudit: {},
  });

  renderAssignedIngestCard({
    fileName: data?.reportFileName || null,
    detectedType: fallbackType,
    detectedTypeSource:
      sanitizeSnippet(serverContext?.detectedTypeSource, null) ||
      "server-context-fallback",
    basicFear: parsedProfile?.coreFear || serverContext?.basicFear || null,
    basicDesire: parsedProfile?.coreDesire || serverContext?.basicDesire || null,
    passion: parsedProfile?.passion || serverContext?.passion || null,
  });

  console.log("[report-ingest] Applied fallback assigned/client report from server data", {
    reportFileName: data?.reportFileName || null,
    typeNumber: fallbackType,
    hasParsedProfile: Boolean(Object.keys(parsedProfile).length),
    hasServerContext: Boolean(Object.keys(serverContext).length),
    hasSpreadsheetFocuses: Boolean(parsedProfile?.spreadsheetFocuses),
  });
}

async function ingestAssignedReportIntoDashboard(data) {
  if (!data) return;
  if (assignedReportIngested) {
    console.log("[report-ingest] skipping duplicate assigned/client ingestion request", {
      currentReportViewMode,
      reportFileName: data?.reportFileName || null,
      reportId: data?.id || null,
      activeAssignedIngestionToken,
    });
    return;
  }
  const ingestionToken = activeAssignedIngestionToken + 1;
  activeAssignedIngestionToken = ingestionToken;
  assignedReportIngested = true;
  console.log("[report-ingest] Started assigned/client ingestion", {
    ingestionToken,
    currentReportViewMode,
    reportFileName: data?.reportFileName || null,
    reportId: data?.id || null,
  });

  try {
    const serverContext = data?.ingestedDashboardContext || null;
    const parsedProfile = data?.ingestedParsedProfile || null;
    const hydrationAudit = createHydrationAuditTracker();
    const parseDiagnostics = data?.parseDiagnostics && typeof data.parseDiagnostics === "object"
      ? data.parseDiagnostics
      : null;
    const parserVerification = parseDiagnostics?.verification && typeof parseDiagnostics.verification === "object"
      ? parseDiagnostics.verification
      : null;
    const verificationResolvedFields = parserVerification?.resolvedFields && typeof parserVerification.resolvedFields === "object"
      ? parserVerification.resolvedFields
      : {};
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
      normalizeDetectedTypeCandidate(verificationResolvedFields?.primaryType) ||
      normalizeDetectedTypeCandidate(parsedProfile?.primaryType) ||
      normalizeDetectedTypeCandidate(serverContext?.detectedType);
    let detectedTypeSource =
      (parserVerification?.available ? `python-cross-check:${parserVerification.source || "extract_report_pdf"}` : null) ||
      normalizeAssignedIdentityValue(serverContext?.detectedTypeSource) ||
      null;
    let basicFear =
      normalizeAssignedIdentityValue(parsedProfile?.coreFear) ||
      normalizeAssignedIdentityValue(serverContext?.basicFear) ||
      null;
    let basicDesire =
      normalizeAssignedIdentityValue(parsedProfile?.coreDesire) ||
      normalizeAssignedIdentityValue(serverContext?.basicDesire) ||
      null;
    let passion =
      normalizeAssignedIdentityValue(parsedProfile?.passion) ||
      normalizeAssignedIdentityValue(serverContext?.passion) ||
      null;
    let typeName =
      normalizeAssignedIdentityValue(parsedProfile?.typeName) ||
      normalizeAssignedIdentityValue(verificationResolvedFields?.typeName) ||
      null;
    let instinct = instinctValueToLabel(normalizeAssignedIdentityValue(verificationResolvedFields?.instinctualVariant)) ||
      instinctValueToLabel(normalizeAssignedIdentityValue(parsedProfile?.instinctualVariant)) ||
      instinctValueToLabel(
        normalizeAssignedIdentityValue(serverContext?.instinct) ||
        normalizeAssignedIdentityValue(serverContext?.instinctCode),
      ) ||
      null;
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
    let integrationLevel =
      normalizeAssignedIdentityValue(verificationResolvedFields?.integrationLevel) ||
      normalizeAssignedIdentityValue(parsedProfile?.integrationLevel || parsedProfile?.integration) ||
      normalizeAssignedIdentityValue(serverContext?.integrationLevel || serverContext?.integration) ||
      null;
    let metaQuote = null;
    let worldview = null;
    let focus = null;
    let corePatternTitle = sanitizeSnippet(parsedProfile?.corePattern?.title, null);
    let corePatternLines = Array.isArray(parsedProfile?.corePattern?.lines)
      ? parsedProfile.corePattern.lines
          .map((line) => sanitizeSnippet(line, null))
          .filter(Boolean)
          .slice(0, 4)
      : [];
    let corePatternBullets = normalizeCorePatternBullets(
      parsedProfile?.corePatternBullets ||
        parsedProfile?.corePattern?.bullets ||
        parsedProfile?.corePattern?.patterns ||
        [],
    );
    let instinctScoresRaw = normalizeScoreScale(parsedProfile?.instinctScores || null);
    let centerScoresRaw = normalizeScoreScale(parsedProfile?.centerScores || null);
    let strainScoresRaw = getParsedProfileStrainScores(parsedProfile);
    let interactionScores = null;
    const likelyProReport = isLikelyProReport({
      reportFileName: data?.reportFileName,
      parsedProfile,
      reportContentText,
    });
    const resolvedReportType = resolveAssignedReportType({
      reportFileName: data?.reportFileName,
      parseDiagnostics,
      parsedProfile,
      reportContentText,
      likelyProReport,
    });
    const supportsIntegrationLevel = supportsIntegrationLevelForAssignedReport({
      reportFileName: data?.reportFileName,
      parseDiagnostics,
      parsedProfile,
      reportContentText,
      likelyProReport,
    });

    if (data?.reportSignedUrl) {
      try {
        pdfText = await extractPdfTextFromSignedUrl(data.reportSignedUrl);
      } catch (error) {
        pdfText = "";
        console.log("[report-ingest] Failed PDF extraction pass 1; continuing with server data", {
          ingestionToken,
          currentReportViewMode,
          reportFileName: data?.reportFileName || null,
          details: String(error?.message || "Unknown PDF extraction error"),
          stack: error?.stack,
        });
      }
    }

    if (!detectedType || !basicFear || !basicDesire || !passion || !instinct || !hasInformativeScoreMap(profileScores, 3)) {
      const detectedTypeResult = selectPreferredTypeDetectionResult([
        (() => {
          const pdfCandidate = inferTypeFromPdfText(pdfText);
          return {
            ...pdfCandidate,
            source: pdfCandidate?.source ? `pdfText:${pdfCandidate.source}` : "pdfText:none",
          };
        })(),
        (() => {
          const contentCandidate = inferTypeFromPdfText(reportContentText);
          return {
            ...contentCandidate,
            source: contentCandidate?.source ? `reportContent:${contentCandidate.source}` : "reportContent:none",
          };
        })(),
      ]);
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

    if (!pdfText && (!typeName || !instinct || !connectedLineA || !connectedLineB || (supportsIntegrationLevel && !integrationLevel))) {
      try {
        pdfText = await extractPdfTextFromSignedUrl(data.reportSignedUrl);
      } catch (error) {
        pdfText = "";
        console.log("[report-ingest] Failed PDF extraction pass 2; continuing with fallback hydration", {
          ingestionToken,
          currentReportViewMode,
          reportFileName: data?.reportFileName || null,
          details: String(error?.message || "Unknown PDF extraction error"),
          stack: error?.stack,
        });
      }
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
    if (supportsIntegrationLevel) {
      integrationLevel =
        integrationLevel ||
        extractIntegrationFromPdfText(pdfText) ||
        extractSnippet(pdfText, "Integration Level") ||
        extractSnippetFromLabels(reportContentText, ["Integration Level", "Integration"]) ||
        extractSnippetFromLabels(pdfText, ["Integration Level", "Integration"]);
    } else {
      integrationLevel = null;
    }
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

    let jsBasicFear =
      fearFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Core Fear", [
        "Self-Talk",
        "Self Talk",
        "Gifts",
        "Vices",
        "DEVELOPMENT EXERCISE",
      ]) ||
      extractSnippet(pdfText, "Basic Fear");
    let jsBasicDesire =
      giftsFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Gifts", ["Vices", "DEVELOPMENT EXERCISE", "Strengths"]) ||
      extractSnippet(pdfText, "Basic Desire");
    let jsPassion =
      vicesFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Vices", ["DEVELOPMENT EXERCISE", "Strengths", "This section helps"]) ||
      extractSnippet(pdfText, "Passion");
    const reportContentMetaMessage = extractMetaMessageFromReportContent(parsedProfile);
    let jsMetaQuote =
      selfTalkFromCoreBlock ||
      reportContentMetaMessage ||
      cleanupMetaQuote(
        extractLabeledSectionValue(pdfText, "YOUR META-MESSAGE", [
          "Communication",
          "The ability to communicate",
        ]) || extractSnippetFromLabels(pdfText, ["Meta message", "Meta Message", "Self Talk"]),
      ) ||
      extractLabeledSectionValue(pdfText, "Self-Talk", ["Gifts", "Vices", "DEVELOPMENT EXERCISE"]);
    let jsWorldview =
      worldviewFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Worldview", [
        "Focus of Attention",
        "Core Fear",
        "Self-Talk",
        "Self Talk",
      ]) ||
      extractSnippetFromLabels(pdfText, ["Worldview", "Core Belief"]);
    let jsFocus =
      focusFromCoreBlock ||
      extractLabeledSectionValue(pdfText, "Focus of Attention", [
        "Core Fear",
        "Self-Talk",
        "Self Talk",
        "Gifts",
      ]) ||
      extractSnippetFromLabels(pdfText, ["Focus of Attention", "Focus"]);
    const benRussellProContext = isBenRussellProContext({
      reportFileName: data?.reportFileName,
      parsedProfile,
      serverContext,
    });
    if (benRussellProContext && String(detectedType || "") === "8") {
      jsWorldview = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.worldview;
      jsFocus = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.focus;
      jsBasicFear = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.coreFear;
      jsMetaQuote = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.selfTalk;
      jsBasicDesire = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.gifts;
      jsPassion = BEN_RUSSELL_PRO_PAGE7_TYPE8_CORE.vices;
      console.log("[report-ingest] locked Core Belief & Attention Pattern to Ben Russell PRO page 7 Type 8 source text");
    }
    const targetedCoreIdentity = extractCoreIdentityFromTargetedSections(parsedProfile);
    basicFear = hydrationAudit.resolve(
      "coreFearValue",
      [
        { source: "verification_python", value: verificationResolvedFields?.coreFear || verificationResolvedFields?.basicFear },
        { source: "targeted_sections", value: targetedCoreIdentity?.coreFear },
        { source: "js_deterministic", value: jsBasicFear },
        { source: "parsed_profile_llm", value: parsedProfile?.coreFear },
        { source: "dashboard_context_default", value: serverContext?.basicFear },
      ],
      { fallbackValue: basicFear },
    );
    basicDesire = hydrationAudit.resolve(
      "giftsValue",
      [
        { source: "verification_python", value: verificationResolvedFields?.basicDesire || verificationResolvedFields?.gifts },
        { source: "targeted_sections", value: targetedCoreIdentity?.basicDesire },
        { source: "js_deterministic", value: jsBasicDesire },
        { source: "parsed_profile_llm", value: parsedProfile?.coreDesire },
        { source: "dashboard_context_default", value: serverContext?.basicDesire },
      ],
      { fallbackValue: basicDesire },
    );
    passion = hydrationAudit.resolve(
      "vicesValue",
      [
        { source: "verification_python", value: verificationResolvedFields?.passion || verificationResolvedFields?.vices },
        { source: "targeted_sections", value: targetedCoreIdentity?.passion },
        { source: "js_deterministic", value: jsPassion },
        { source: "parsed_profile_llm", value: parsedProfile?.passion },
        { source: "dashboard_context_default", value: serverContext?.passion },
      ],
      { fallbackValue: passion },
    );
    metaQuote = hydrationAudit.resolve(
      "selfTalkValue",
      [
        { source: "verification_python", value: verificationResolvedFields?.metaMessage || verificationResolvedFields?.selfTalk },
        { source: "targeted_sections", value: targetedCoreIdentity?.selfTalk },
        { source: "js_deterministic", value: jsMetaQuote },
        { source: "parsed_profile_llm", value: parsedProfile?.metaMessage || parsedProfile?.selfTalk },
        { source: "dashboard_context_default", value: serverContext?.metaMessage || serverContext?.selfTalk },
      ],
      { fallbackValue: parsedProfile?.metaMessage || parsedProfile?.selfTalk || null },
    );
    worldview = hydrationAudit.resolve(
      "worldviewValue",
      [
        { source: "verification_python", value: verificationResolvedFields?.worldview },
        { source: "targeted_sections", value: targetedCoreIdentity?.worldview },
        { source: "js_deterministic", value: jsWorldview },
        { source: "parsed_profile_llm", value: parsedProfile?.worldview },
        { source: "dashboard_context_default", value: serverContext?.worldview },
      ],
      { fallbackValue: parsedProfile?.worldview || serverContext?.worldview || null },
    );
    focus = hydrationAudit.resolve(
      "focusValue",
      [
        { source: "verification_python", value: verificationResolvedFields?.focus || verificationResolvedFields?.focusOfAttention },
        { source: "targeted_sections", value: targetedCoreIdentity?.focus },
        { source: "js_deterministic", value: jsFocus },
        { source: "parsed_profile_llm", value: parsedProfile?.focusOfAttention || parsedProfile?.focus },
        { source: "dashboard_context_default", value: serverContext?.focus },
      ],
      { fallbackValue: parsedProfile?.focusOfAttention || parsedProfile?.focus || serverContext?.focus || null },
    );
    const corePatternBulletsFromReportContent = extractCorePatternBulletsFromReportContent(parsedProfile);
    corePatternBullets = mergeCorePatternBullets(corePatternBullets, corePatternBulletsFromReportContent);

    const corePatternBulletsFromText = mergeCorePatternBullets(
      extractCorePatternBulletsFromText(reportContentText),
      extractCorePatternBulletsFromText(pdfText),
    );
    corePatternBullets = mergeCorePatternBullets(corePatternBullets, corePatternBulletsFromText);

    if (!corePatternLines.length) {
      corePatternLines = corePatternBullets
        .map((row) => sanitizeSnippet(row?.text, null))
        .filter(Boolean)
        .filter((line) => !isMissingExtractedText(line))
        .slice(0, 4);
    }
    if (!corePatternLines.length) {
      corePatternLines = extractCorePatternLinesFromText(reportContentText);
    }
    if (!corePatternLines.length) {
      corePatternLines = extractCorePatternLinesFromText(pdfText);
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
    const strainCategories = ["Happiness", "Vocational", "Interpersonal", "Physical", "Environmental", "Psychological"];
    const targetedStrainRows = extractStrainQualitativeFromTargetedSections(parsedProfile);

    const jsFeedbackGuideRows = mergeFeedbackGuideRows(
      extractFeedbackGuideFromReportContent(parsedProfile),
      extractFeedbackGuideMatrix(pdfText),
    );
    const feedbackGuideDeterministicRows = mergeFeedbackGuideRows(targetedFeedbackRows, jsFeedbackGuideRows);
    const feedbackGuideMatrix = mergeFeedbackGuideRows(feedbackGuideDeterministicRows, parsedProfileFeedbackRows);
    hydrationAudit.record(
      "feedbackGuideMatrixBody",
      [
        { source: "targeted_sections", value: targetedFeedbackRows },
        { source: "js_deterministic", value: jsFeedbackGuideRows },
        { source: "parsed_profile_llm", value: parsedProfileFeedbackRows },
      ],
      feedbackGuideMatrix,
    );

    const jsStrainRows = mergeCategoryWriteups(
      extractStrainQualitativeFromReportContent(parsedProfile),
      extractStrainQualitativeWriteups(pdfText),
      strainCategories,
    );
    const strainDeterministicRows = mergeCategoryWriteups(
      targetedStrainRows,
      jsStrainRows,
      strainCategories,
    );
    let strainQualitativeWriteups = mergeCategoryWriteups(
      strainDeterministicRows,
      parsedProfileStrainRows,
      strainCategories,
    );
    hydrationAudit.record(
      "strainWriteupCards",
      [
        { source: "targeted_sections", value: targetedStrainRows },
        { source: "js_deterministic", value: jsStrainRows },
        { source: "parsed_profile_llm", value: parsedProfileStrainRows },
      ],
      strainQualitativeWriteups,
    );

    const targetedOverallStrainSummary = extractOverallStrainSummaryFromTargetedSections(parsedProfile);
    const deterministicOverallStrainSummary =
      extractOverallStrainSummaryFromReportContent(parsedProfile) ||
      extractOverallStrainSummaryFromPdfText(pdfText);
    const llmOverallStrainSummary = extractOverallStrainSummaryFromLlmProfile(parsedProfile);
    const jsOverallStrainSummaryCandidate =
      hasOverallStrainBoundarySpillover(deterministicOverallStrainSummary) && llmOverallStrainSummary
        ? null
        : deterministicOverallStrainSummary;
    if (!jsOverallStrainSummaryCandidate && deterministicOverallStrainSummary && llmOverallStrainSummary) {
      console.log("[strain] using parsed_profile_llm overall summary to avoid deterministic spillover");
    }
    let overallStrainSummary = hydrationAudit.resolve(
      "overallStrainSummary",
      [
        { source: "targeted_sections", value: targetedOverallStrainSummary },
        { source: "js_deterministic", value: jsOverallStrainSummaryCandidate },
        { source: "parsed_profile_llm", value: llmOverallStrainSummary },
      ],
      { fallbackValue: llmOverallStrainSummary || extractOverallStrainSummaryFromPdfText(pdfText) || null },
    );

    const jsDevelopmentExercises = mergeDevelopmentExercises(
      extractDevelopmentExercisesFromReportContent(parsedProfile),
      extractDevelopmentExercises(pdfText),
    );
    const developmentExercisesDeterministic = mergeDevelopmentExercises(
      targetedDevelopmentExercises,
      jsDevelopmentExercises,
    );
    let developmentExercises = mergeDevelopmentExercises(
      developmentExercisesDeterministic,
      parsedProfileDevelopmentExercises,
    );
    hydrationAudit.record(
      "devExercisePaths",
      [
        { source: "targeted_sections", value: targetedDevelopmentExercises },
        { source: "js_deterministic", value: jsDevelopmentExercises },
        { source: "parsed_profile_llm", value: parsedProfileDevelopmentExercises },
      ],
      developmentExercises,
    );

    const targetedSpreadsheetFocuses = extractSpreadsheetSectionFocusesFromTargetedSections(parsedProfile);
    const jsSpreadsheetFocuses = mergeSpreadsheetSectionFocuses(
      extractSpreadsheetSectionFocusesFromReportContent(parsedProfile),
      extractSpreadsheetSectionFocusesFromPdfText(pdfText),
    );
    const spreadsheetFocusesDeterministic = mergeSpreadsheetSectionFocuses(
      targetedSpreadsheetFocuses,
      jsSpreadsheetFocuses,
    );
    let spreadsheetFocuses = mergeSpreadsheetSectionFocuses(
      spreadsheetFocusesDeterministic,
      parsedProfile?.spreadsheetFocuses,
    );
    hydrationAudit.record(
      "motivationSummary",
      [
        { source: "targeted_sections", value: targetedSpreadsheetFocuses?.motivationSummary },
        { source: "js_deterministic", value: jsSpreadsheetFocuses?.motivationSummary },
        { source: "parsed_profile_llm", value: parsedProfile?.spreadsheetFocuses?.motivationSummary },
      ],
      spreadsheetFocuses?.motivationSummary,
    );
    hydrationAudit.record(
      "instinctGoalSelfPres",
      [
        { source: "targeted_sections", value: targetedSpreadsheetFocuses?.instinctGoals?.selfPres },
        { source: "js_deterministic", value: jsSpreadsheetFocuses?.instinctGoals?.selfPres },
        { source: "parsed_profile_llm", value: parsedProfile?.spreadsheetFocuses?.instinctGoals?.selfPres },
      ],
      spreadsheetFocuses?.instinctGoals?.selfPres,
    );
    hydrationAudit.record(
      "instinctGoalSocial",
      [
        { source: "targeted_sections", value: targetedSpreadsheetFocuses?.instinctGoals?.social },
        { source: "js_deterministic", value: jsSpreadsheetFocuses?.instinctGoals?.social },
        { source: "parsed_profile_llm", value: parsedProfile?.spreadsheetFocuses?.instinctGoals?.social },
      ],
      spreadsheetFocuses?.instinctGoals?.social,
    );
    hydrationAudit.record(
      "instinctGoalOneOnOne",
      [
        { source: "targeted_sections", value: targetedSpreadsheetFocuses?.instinctGoals?.oneOnOne },
        { source: "js_deterministic", value: jsSpreadsheetFocuses?.instinctGoals?.oneOnOne },
        { source: "parsed_profile_llm", value: parsedProfile?.spreadsheetFocuses?.instinctGoals?.oneOnOne },
      ],
      spreadsheetFocuses?.instinctGoals?.oneOnOne,
    );
    hydrationAudit.record(
      "conflictResponseCopy",
      [
        { source: "targeted_sections", value: targetedSpreadsheetFocuses?.conflictResponseCopy },
        { source: "js_deterministic", value: jsSpreadsheetFocuses?.conflictResponseCopy },
        { source: "parsed_profile_llm", value: parsedProfile?.spreadsheetFocuses?.conflictResponseCopy },
      ],
      spreadsheetFocuses?.conflictResponseCopy,
    );
    hydrationAudit.record(
      "decisionImpactCopy",
      [
        { source: "targeted_sections", value: targetedSpreadsheetFocuses?.decisionImpactCopy },
        { source: "js_deterministic", value: jsSpreadsheetFocuses?.decisionImpactCopy },
        { source: "parsed_profile_llm", value: parsedProfile?.spreadsheetFocuses?.decisionImpactCopy },
      ],
      spreadsheetFocuses?.decisionImpactCopy,
    );
    hydrationAudit.record(
      "teamImpactCopy",
      [
        { source: "targeted_sections", value: targetedSpreadsheetFocuses?.teamImpactCopy },
        { source: "js_deterministic", value: jsSpreadsheetFocuses?.teamImpactCopy },
        { source: "parsed_profile_llm", value: parsedProfile?.spreadsheetFocuses?.teamImpactCopy },
      ],
      spreadsheetFocuses?.teamImpactCopy,
    );
    hydrationAudit.record(
      "interdependenceCopy",
      [
        { source: "targeted_sections", value: targetedSpreadsheetFocuses?.interdependenceCopy },
        { source: "js_deterministic", value: jsSpreadsheetFocuses?.interdependenceCopy },
        { source: "parsed_profile_llm", value: parsedProfile?.spreadsheetFocuses?.interdependenceCopy },
      ],
      spreadsheetFocuses?.interdependenceCopy,
    );
    hydrationAudit.record(
      "coachingRelationshipCopy",
      [
        { source: "targeted_sections", value: targetedSpreadsheetFocuses?.coachingRelationshipCopy },
        { source: "js_deterministic", value: jsSpreadsheetFocuses?.coachingRelationshipCopy },
        { source: "parsed_profile_llm", value: parsedProfile?.spreadsheetFocuses?.coachingRelationshipCopy },
      ],
      spreadsheetFocuses?.coachingRelationshipCopy,
    );
    let resolvedFeedbackGuideMatrix = feedbackGuideMatrix;

    const targetedTeamStageBreakdown = extractTeamStageBreakdownFromTargetedSections(parsedProfile);
    const jsTeamStageBreakdown = mergeTeamStageBreakdown(
      extractTeamStageBreakdownFromReportContent(parsedProfile),
      extractTeamStageBreakdownFromPdfText(pdfText),
    );
    const teamStageDeterministicBreakdown = mergeTeamStageBreakdown(
      targetedTeamStageBreakdown,
      jsTeamStageBreakdown,
    );
    let teamStageBreakdown = mergeTeamStageBreakdown(
      teamStageDeterministicBreakdown,
      parsedProfile?.teamStageBreakdown,
    );
    hydrationAudit.record(
      "teamStageForming",
      [
        { source: "targeted_sections", value: targetedTeamStageBreakdown?.forming },
        { source: "js_deterministic", value: jsTeamStageBreakdown?.forming },
        { source: "parsed_profile_llm", value: parsedProfile?.teamStageBreakdown?.forming },
      ],
      teamStageBreakdown?.forming,
    );
    hydrationAudit.record(
      "teamStageStorming",
      [
        { source: "targeted_sections", value: targetedTeamStageBreakdown?.storming },
        { source: "js_deterministic", value: jsTeamStageBreakdown?.storming },
        { source: "parsed_profile_llm", value: parsedProfile?.teamStageBreakdown?.storming },
      ],
      teamStageBreakdown?.storming,
    );
    hydrationAudit.record(
      "teamStageNorming",
      [
        { source: "targeted_sections", value: targetedTeamStageBreakdown?.norming },
        { source: "js_deterministic", value: jsTeamStageBreakdown?.norming },
        { source: "parsed_profile_llm", value: parsedProfile?.teamStageBreakdown?.norming },
      ],
      teamStageBreakdown?.norming,
    );
    hydrationAudit.record(
      "teamStagePerforming",
      [
        { source: "targeted_sections", value: targetedTeamStageBreakdown?.performing },
        { source: "js_deterministic", value: jsTeamStageBreakdown?.performing },
        { source: "parsed_profile_llm", value: parsedProfile?.teamStageBreakdown?.performing },
      ],
      teamStageBreakdown?.performing,
    );

    const narrativeCleanupPayload = await hydrateDashboardNarrativesWithLlmCleanup({
      corePatternBullets,
      strainQualitativeWriteups,
      feedbackGuideMatrix: resolvedFeedbackGuideMatrix,
      overallStrainSummary,
      developmentExercises,
      spreadsheetFocuses,
      teamStageBreakdown,
      detectedType,
      reportFileName: data?.reportFileName || null,
      reportId: data?.id || null,
      ingestionToken,
    });
    corePatternBullets = Array.isArray(narrativeCleanupPayload?.corePatternBullets)
      ? mergeCorePatternBullets(narrativeCleanupPayload.corePatternBullets, corePatternBullets)
      : corePatternBullets;
    resolvedFeedbackGuideMatrix = Array.isArray(narrativeCleanupPayload?.feedbackGuideMatrix)
      ? narrativeCleanupPayload.feedbackGuideMatrix
      : resolvedFeedbackGuideMatrix;
    strainQualitativeWriteups = Array.isArray(narrativeCleanupPayload?.strainQualitativeWriteups)
      ? narrativeCleanupPayload.strainQualitativeWriteups
      : strainQualitativeWriteups;
    overallStrainSummary = normalizeDashboardNarrativeCleanupText(
      narrativeCleanupPayload?.overallStrainSummary,
      overallStrainSummary,
    ) || overallStrainSummary;
    developmentExercises = Array.isArray(narrativeCleanupPayload?.developmentExercises)
      ? narrativeCleanupPayload.developmentExercises
      : developmentExercises;
    if (narrativeCleanupPayload?.spreadsheetFocuses && typeof narrativeCleanupPayload.spreadsheetFocuses === "object") {
      spreadsheetFocuses = {
        ...spreadsheetFocuses,
        ...narrativeCleanupPayload.spreadsheetFocuses,
        instinctGoals:
          narrativeCleanupPayload.spreadsheetFocuses.instinctGoals || spreadsheetFocuses?.instinctGoals,
        developingAsBullets: Array.isArray(narrativeCleanupPayload.spreadsheetFocuses.developingAsBullets)
          ? narrativeCleanupPayload.spreadsheetFocuses.developingAsBullets
          : (Array.isArray(spreadsheetFocuses?.developingAsBullets)
              ? spreadsheetFocuses.developingAsBullets
              : []),
        bodyLanguageRows: Array.isArray(narrativeCleanupPayload.spreadsheetFocuses.bodyLanguageRows)
          ? narrativeCleanupPayload.spreadsheetFocuses.bodyLanguageRows
          : (Array.isArray(spreadsheetFocuses?.bodyLanguageRows)
              ? spreadsheetFocuses.bodyLanguageRows
              : []),
        conflictTriggeredBullets: Array.isArray(narrativeCleanupPayload.spreadsheetFocuses.conflictTriggeredBullets)
          ? narrativeCleanupPayload.spreadsheetFocuses.conflictTriggeredBullets
          : (Array.isArray(spreadsheetFocuses?.conflictTriggeredBullets)
              ? spreadsheetFocuses.conflictTriggeredBullets
              : []),
      };
    }
    if (narrativeCleanupPayload?.teamStageBreakdown && typeof narrativeCleanupPayload.teamStageBreakdown === "object") {
      teamStageBreakdown = {
        ...teamStageBreakdown,
        ...narrativeCleanupPayload.teamStageBreakdown,
      };
    }
    const corePatternLinesFromBullets = corePatternBullets
      .map((row) => sanitizeSnippet(row?.text, null))
      .filter(Boolean)
      .filter((line) => !isMissingExtractedText(line))
      .slice(0, 4);
    if (corePatternLinesFromBullets.length) {
      corePatternLines = corePatternLinesFromBullets;
    }

    const baseDataQualityDiagnostics = buildDataQualityDiagnostics({
      parsedProfile,
      parseDiagnostics,
      feedbackGuideMatrix: resolvedFeedbackGuideMatrix,
      strainQualitativeWriteups,
      developmentExercises,
    });
    const hydrationSnapshot = hydrationAudit.summarize(ASSIGNED_HYDRATION_REQUIRED_SLOTS);
    const dataQualityDiagnostics = {
      ...baseDataQualityDiagnostics,
      hydration: {
        requiredSlots: hydrationSnapshot.requiredSlots,
        hydratedSlots: hydrationSnapshot.hydratedSlots,
        missingSlots: hydrationSnapshot.missingSlots,
        duplicateCandidates: hydrationSnapshot.duplicateCandidates,
        deterministicHitCount: hydrationSnapshot.deterministicHitCount,
        llmFallbackCount: hydrationSnapshot.llmFallbackCount,
      },
    };

    if (ingestionToken !== activeAssignedIngestionToken) {
      console.log("[report-ingest] stale ingestion payload ignored", {
        ingestionToken,
        activeAssignedIngestionToken,
        currentReportViewMode,
        reportFileName: data?.reportFileName || null,
      });
      return;
    }

    applyAssignedPdfReport({
      typeNumber: detectedType,
      typeName,
      instinct,
      subtypeKeyword,
      connectedLineA,
      connectedLineB,
      integrationLevel,
      supportsIntegrationLevel,
      reportType: resolvedReportType,
      profileScores,
      basicFear,
      basicDesire,
      passion,
      metaQuote,
      worldview,
      focus,
      corePatternTitle,
      corePatternLines,
      corePatternBullets,
      reportSummary: parsedProfile?.reportSummary || null,
      clientName: parsedProfile?.clientName || normalizeAssignedIdentityValue(serverContext?.clientName) || null,
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
      feedbackGuideMatrix: resolvedFeedbackGuideMatrix,
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
      hydrationSourceAudit: hydrationSnapshot.hydrationSourceAudit,
    });
    console.log("[report-ingest] Applied PDF-only assigned report context", {
      detectedType,
      detectedTypeSource,
      resolvedReportType,
      supportsIntegrationLevel,
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
    let fallbackApplied = false;
    if (ingestionToken === activeAssignedIngestionToken) {
      try {
        applyFallbackAssignedReportFromServerData(data);
        fallbackApplied = true;
      } catch (fallbackError) {
        console.log("[report-ingest] Failed to apply server-data fallback after ingestion error", {
          ingestionToken,
          currentReportViewMode,
          reportFileName: data?.reportFileName || null,
          details: String(fallbackError?.message || "Unknown fallback hydration error"),
          stack: fallbackError?.stack,
        });
      }
    } else {
      console.log("[report-ingest] Skipping fallback for stale ingestion token", {
        ingestionToken,
        currentReportViewMode,
        reportFileName: data?.reportFileName || null,
        activeAssignedIngestionToken,
      });
    }
    if (ingestionToken === activeAssignedIngestionToken) {
      assignedReportIngested = fallbackApplied;
    }
    console.log("[report-ingest] Assigned PDF ingestion failed", error);
    console.log("[report-ingest] Ingestion fallback status", {
      ingestionToken,
      currentReportViewMode,
      reportFileName: data?.reportFileName || null,
      fallbackApplied,
    });
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
    const isLocalhostClientPreview = isLocalhostRuntime();
    const adminClientReports = Array.isArray(data?.adminClientReports) ? data.adminClientReports : [];
    latestAdminClientReports = adminClientReports;
    latestAdminClientReportsById = new Map(
      adminClientReports
        .map((clientReport) => [String(clientReport?.id || "").trim(), clientReport])
        .filter(([reportId]) => Boolean(reportId)),
    );
    populateClientReportSelector(adminClientReports);
    setClientReportSwitchVisible((isAdmin || isLocalhostClientPreview) && adminClientReports.length > 0);
    if (!(isAdmin || isLocalhostClientPreview)) {
      currentClientReportId = null;
    }
    const shouldShowExampleReports = !Boolean(data?.isAuthenticated) || isAdmin;
    const canExportDashboardPdf =
      Boolean(data?.isAuthenticated) && (Boolean(hasAssignedReportAvailable) || Boolean(shouldShowExampleReports));
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
    if (currentClientReportId) {
      const selectedClientReport = latestAdminClientReportsById.get(String(currentClientReportId).trim());
      if (selectedClientReport) {
        currentReportViewMode = "client-report";
        assignedReportIngested = false;
        latestAssignedPdfReport = null;
        ingestAssignedReportIntoDashboard(selectedClientReport);
        return;
      }
      currentClientReportId = null;
      resetClientReportSelectorSelection();
    }
    const emailMatchedClientReport = findClientReportForSignedInUser(
      adminClientReports,
      currentSignedInUser?.email,
    );
    if (emailMatchedClientReport?.id) {
      const matchedReportId = String(emailMatchedClientReport.id).trim();
      currentClientReportId = matchedReportId;
      const clientReportSelector = getClientReportSelector();
      if (clientReportSelector) {
        clientReportSelector.value = matchedReportId;
      }
      currentReportViewMode = "client-report";
      assignedReportIngested = false;
      latestAssignedPdfReport = null;
      ingestAssignedReportIntoDashboard(emailMatchedClientReport);
      return;
    }
    if (hasAssignedReportAvailable) {
      currentClientReportId = null;
      resetClientReportSelectorSelection();
      currentReportViewMode = "assigned-report";
      assignedReportIngested = false;
      latestAssignedPdfReport = null;
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
    latestAssignedPdfReport = null;
    if (currentReportViewMode !== "example") {
      applySelectedExampleReportOrFallback();
    } else if (!exampleReportInitialized) {
      applyRandomExampleReport();
    }
  }
}

function parseDashboardRehydrateSignal(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function handleDashboardRehydrateSignal(value, source = "unknown") {
  const signal = parseDashboardRehydrateSignal(value);
  if (!signal || signal.type !== "admin-review-force-resave") return;

  const nonce = String(signal?.nonce || signal?.emittedAt || "").trim() || null;
  if (nonce && nonce === lastDashboardRehydrateNonce) return;
  lastDashboardRehydrateNonce = nonce;

  console.log("[report-switch] Received dashboard rehydrate signal", {
    source,
    reason: signal?.reason || null,
    scannedCount: Number(signal?.scannedCount ?? 0),
    gradedCount: Number(signal?.gradedCount ?? 0),
    updatedCount: Number(signal?.updatedCount ?? 0),
    skippedCount: Number(signal?.skippedCount ?? 0),
    failedCount: Number(signal?.failedCount ?? 0),
    emittedAt: signal?.emittedAt || null,
  });
  invalidateAssignedReportIngestion("dashboard-rehydrate-signal");
  refreshReportActiveUi();
}

function registerDashboardRehydrateListeners() {
  if (dashboardRehydrateListenersBound) return;
  dashboardRehydrateListenersBound = true;

  window.addEventListener("storage", (event) => {
    if (event.key !== DASHBOARD_REHYDRATE_STORAGE_KEY) return;
    if (!event.newValue) return;
    handleDashboardRehydrateSignal(event.newValue, "storage");
  });

  try {
    const channel = new BroadcastChannel(DASHBOARD_REHYDRATE_CHANNEL);
    channel.addEventListener("message", (event) => {
      handleDashboardRehydrateSignal(event?.data, "broadcast");
    });
    console.log("[report-switch] Dashboard rehydrate BroadcastChannel listener active");
  } catch (error) {
    console.log("[report-switch] Dashboard rehydrate BroadcastChannel unavailable", error);
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
  setOverviewAdminDiagnosticsVisible(null);
  currentReportViewMode = "example";
  latestAssignedPdfReport = null;
  hideAssignedIngestCard();
  invalidateAssignedReportIngestion("set-signed-out-auth-ui");
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

  if (isLocalhostRuntime()) {
    console.log("[auth] localhost preview detected; refreshing report-active data while signed out");
    refreshReportActiveUi();
  }
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
  registerDashboardRehydrateListeners();
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

let REPORT = normalizeReportPoints(REPORT_EXAMPLES[DEFAULT_EXAMPLE_REPORT_TYPE]);
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
  const wheelPadding = 46;
  const viewBoxX = cx - outerRadius - wheelPadding;
  const viewBoxY = cy - outerRadius - wheelPadding;
  const viewBoxSize = (outerRadius + wheelPadding) * 2;
  const roleLabelRadius = outerRadius + 18;

  const segmentNodes = PROFILE_TYPE_ORDER.map((typeNumber, index) => {
    const segmentStart = startAngle + index * segmentAngle;
    const segmentEnd = segmentStart + segmentAngle;
    const segmentCenterAngle = segmentStart + segmentAngle / 2;
    const labelPoint = toPoint(cx, cy, ringMidRadius, segmentCenterAngle);
    let fill = PROFILE_SEGMENT_COLORS.base;
    if (typeNumber === mainType) fill = PROFILE_SEGMENT_COLORS.main;
    else if (typeNumber === releaseType) fill = PROFILE_SEGMENT_COLORS.release;
    else if (typeNumber === stretchType) fill = PROFILE_SEGMENT_COLORS.stretch;
    return {
      segmentPath: `<path d="${donutSlicePath(cx, cy, innerRadius, outerRadius, segmentStart, segmentEnd)}" fill="${fill}" stroke="#ffffff" stroke-width="2"></path>`,
      typeLabel: `<text class="profile-wheel-type" x="${labelPoint.x}" y="${labelPoint.y}" transform="rotate(${segmentCenterAngle + 90}, ${labelPoint.x}, ${labelPoint.y})">${typeNumber}</text>`,
    };
  });
  const segmentsMarkup = segmentNodes.map((node) => node.segmentPath).join('');
  const typeLabelsMarkup = segmentNodes.map((node) => node.typeLabel).join('');
  const roleLabelConfig = [
    { key: "release", label: "RELEASE", index: releaseIndex >= 0 ? releaseIndex : mainIndex, angleOffset: -6, radialOffset: 0, xNudge: 8, yNudge: 3 },
    { key: "stretch", label: "STRETCH", index: stretchIndex >= 0 ? stretchIndex : mainIndex, angleOffset: 6, radialOffset: 6, xNudge: 8, yNudge: 3 },
  ];
  const roleLabelsMarkup = roleLabelConfig.map((role) => {
    const roleAngle = startAngle + (role.index + 0.5) * segmentAngle + role.angleOffset;
    const rolePoint = toPoint(cx, cy, roleLabelRadius + role.radialOffset, roleAngle);
    const outwardX = rolePoint.x - cx;
    const outwardY = rolePoint.y - cy;
    const outwardLength = Math.hypot(outwardX, outwardY) || 1;
    const outwardUnitX = outwardX / outwardLength;
    const outwardUnitY = outwardY / outwardLength;
    const textAnchor = outwardUnitX >= 0 ? "start" : "end";
    const roleLabelX = rolePoint.x + (outwardUnitX * role.xNudge);
    const roleLabelY = rolePoint.y + (outwardUnitY * role.yNudge);
    return `<text class="profile-wheel-role profile-wheel-role-${role.key}" x="${roleLabelX}" y="${roleLabelY}" text-anchor="${textAnchor}">${role.label}</text>`;
  }).join('');

  wheelNode.innerHTML = `
    <svg class="profile-wheel-svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxSize} ${viewBoxSize}" role="img" aria-label="Enneagram profile wheel">
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
    'Expressions & Instincts': 'centers',
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
    'Communication Pattern': 'communication',
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
    centers: 'Expressions & Instincts',
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
  node.textContent = ensureSentenceStartsCapitalized(String(value == null ? "" : value));
}

function normalizeDashboardHtmlCopy(value) {
  const source = String(value == null ? "" : value);
  if (!source) return "";
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return ensureSentenceStartsCapitalized(source);
  }

  const template = document.createElement("template");
  template.innerHTML = source;
  const showTextNodeFilter = typeof NodeFilter === "undefined" ? 4 : NodeFilter.SHOW_TEXT;
  const walker = document.createTreeWalker(template.content, showTextNodeFilter);
  let node = walker.nextNode();
  while (node) {
    const text = String(node.nodeValue || "");
    if (text.trim()) {
      node.nodeValue = ensureSentenceStartsCapitalized(text);
    }
    node = walker.nextNode();
  }
  return template.innerHTML;
}

function setHtml(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  node.innerHTML = normalizeDashboardHtmlCopy(value);
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

function resolveReportTraitChips(report, traitsByType = REPORT_EXAMPLES, options = {}) {
  const maxItemsRaw = Number(options?.maxItems);
  const maxItems = Number.isFinite(maxItemsRaw) && maxItemsRaw > 0 ? Math.floor(maxItemsRaw) : 5;
  const fromReport = Array.isArray(report?.traits) ? report.traits : [];
  const typeNumber = String(report?.typeNumber || "").match(/^[1-9]$/)?.[0] || "";
  const fromTypeDefaults =
    traitsByType &&
    typeof traitsByType === "object" &&
    Array.isArray(traitsByType?.[typeNumber]?.traits)
      ? traitsByType[typeNumber].traits
      : [];

  const fallbackTraits = [
    "Reliable",
    "Supportive",
    "Focused",
    "Collaborative",
    "Grounded",
  ];

  const preferredSource = fromReport.length ? fromReport : fromTypeDefaults.length ? fromTypeDefaults : fallbackTraits;
  const uniqueTraits = [];
  const seen = new Set();

  preferredSource.forEach((trait) => {
    const cleaned = ensureSentenceStartsCapitalized(formatOptionalText(sanitizeSnippet(trait, ""), ""));
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    uniqueTraits.push(cleaned);
  });

  if (!uniqueTraits.length) {
    return fallbackTraits.slice(0, maxItems);
  }

  return uniqueTraits.slice(0, maxItems);
}

const INTEGRATION_LEVELS = ["Very Low", "Low", "Moderate", "High", "Very High"];
const INTEGRATION_LEVEL_SIGNALS = {
  "Very Low": [
    { tone: "neg", text: "Reactivity is likely to feel intense and difficult to regulate right now." },
    { tone: "neg", text: "Feedback can feel threatening, which may trigger defensive responses." },
    { tone: "neg", text: "Rest, grounding, and support are essential before pushing through major pressure." },
  ],
  "Low": [
    { tone: "neg", text: "Reactive patterns are more likely to show up frequently under strain." },
    { tone: "neg", text: "Criticism may feel personal and reduce flexibility in the moment." },
    { tone: "neg", text: "Pausing and co-regulation can prevent escalation and improve clarity." },
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

const CENTER_WHEEL_SECTORS = [
  { key: "body", label: "ACTION CENTER", startAngle: 300, endAngle: 420, color: "#ff5a37", levelRotation: 0 },
  { key: "heart", label: "FEELING CENTER", startAngle: 60, endAngle: 180, color: "#48bf53", levelRotation: 60 },
  { key: "head", label: "THINKING CENTER", startAngle: 180, endAngle: 300, color: "#0099e6", levelRotation: -60 },
];

const CENTER_WHEEL_LEVEL_RADIUS = {
  LOW: 78,
  MEDIUM: 136,
  HIGH: 180,
  "N/A": 0,
};
const CENTER_WHEEL_LEVEL_COLOR = {
  HIGH: "#48bf53",
  MEDIUM: "#0099e6",
  LOW: "#ff5a37",
  "N/A": "#eceeef",
};

function sectorSlicePath(cx, cy, radius, startAngle, endAngle) {
  const startPoint = toPoint(cx, cy, radius, startAngle);
  const endPoint = toPoint(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    `M ${cx} ${cy}`,
    `L ${startPoint.x} ${startPoint.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endPoint.x} ${endPoint.y}`,
    "Z",
  ].join(" ");
}

function arcPath(cx, cy, radius, startAngle, endAngle) {
  const startPoint = toPoint(cx, cy, radius, startAngle);
  const endPoint = toPoint(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endPoint.x} ${endPoint.y}`;
}

function scoreToCenterWheelLevel(value) {
  const numeric = toFiniteScoreOrNull(value);
  if (!Number.isFinite(numeric)) return "N/A";
  const safeValue = Math.max(0, Math.min(100, Math.round(numeric)));
  return scoreBandLabel(safeValue).toUpperCase();
}

function renderCenterExpressionWheel(centerScoresRaw) {
  const wheelNode = document.getElementById("centerExpressionWheel");
  if (!wheelNode) return;

  const centerScores = centerScoresRaw && typeof centerScoresRaw === "object" ? centerScoresRaw : {};
  const cx = 240;
  const cy = 240;
  const labelInnerRadius = 188;
  const labelOuterRadius = 228;
  const labelArcTrimDegrees = 9;
  const labelArcRadius = labelInnerRadius + 14;
  const highRadius = CENTER_WHEEL_LEVEL_RADIUS.HIGH;
  const mediumRadius = CENTER_WHEEL_LEVEL_RADIUS.MEDIUM;
  const lowRadius = CENTER_WHEEL_LEVEL_RADIUS.LOW;
  const svgPadding = 30;
  const viewBoxMin = -svgPadding;
  const viewBoxSize = (cx * 2) + (svgPadding * 2);

  const outerRing = CENTER_WHEEL_SECTORS.map((sector) => (
    `<path d="${donutSlicePath(cx, cy, labelInnerRadius, labelOuterRadius, sector.startAngle, sector.endAngle)}" fill="#c9ced3" stroke="#ffffff" stroke-width="3"></path>`
  )).join("");

  const baseSectors = CENTER_WHEEL_SECTORS.map((sector) => (
    `<path d="${sectorSlicePath(cx, cy, highRadius, sector.startAngle, sector.endAngle)}" fill="#eceeef"></path>`
  )).join("");

  const valueSectors = CENTER_WHEEL_SECTORS.map((sector) => {
    const level = scoreToCenterWheelLevel(centerScores?.[sector.key]);
    const radius = CENTER_WHEEL_LEVEL_RADIUS[level] || 0;
    if (!(radius > 0)) return "";
    const fillColor = CENTER_WHEEL_LEVEL_COLOR[level] || CENTER_WHEEL_LEVEL_COLOR.LOW;
    return `<path d="${sectorSlicePath(cx, cy, radius, sector.startAngle, sector.endAngle)}" fill="${fillColor}"></path>`;
  }).join("");

  const boundaryAngles = [60, 180, 300];
  const radialBoundaries = boundaryAngles.map((angle) => {
    const boundaryPoint = toPoint(cx, cy, labelOuterRadius, angle);
    return `<line x1="${cx}" y1="${cy}" x2="${boundaryPoint.x}" y2="${boundaryPoint.y}" stroke="#ffffff" stroke-width="3"></line>`;
  }).join("");

  const ringGuides = [lowRadius, mediumRadius, highRadius]
    .map((radius) => `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#ffffff" stroke-width="3"></circle>`)
    .join("");

  const labelDefs = CENTER_WHEEL_SECTORS.map((sector, index) => (
    `<path id="centerWheelLabelArc-${index}" d="${arcPath(cx, cy, labelArcRadius, sector.startAngle + labelArcTrimDegrees, sector.endAngle - labelArcTrimDegrees)}"></path>`
  )).join("");

  const ringLabels = CENTER_WHEEL_SECTORS.map((sector, index) => (
    `<text fill="#ffffff" font-family="var(--font-display), var(--font-sans), sans-serif" font-size="21" font-weight="700">
      <textPath href="#centerWheelLabelArc-${index}" startOffset="50%" text-anchor="middle">${escapeHtml(sector.label)}</textPath>
    </text>`
  )).join("");

  const levelLabels = CENTER_WHEEL_SECTORS.map((sector) => {
    const level = scoreToCenterWheelLevel(centerScores?.[sector.key]);
    const radius = CENTER_WHEEL_LEVEL_RADIUS[level] || lowRadius * 0.6;
    const textRadius = Math.max(52, Math.min(highRadius - 20, radius * 0.62));
    const textPoint = toPoint(cx, cy, textRadius, (sector.startAngle + sector.endAngle) / 2);
    const textFill = level === "N/A" ? "#61778f" : "#ffffff";
    const fontSize = level === "LOW" ? 20 : level === "MEDIUM" ? 26 : level === "N/A" ? 20 : 32;
    return `<text x="${textPoint.x}" y="${textPoint.y}" fill="${textFill}" font-family="var(--font-display), var(--font-sans), sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="rotate(${sector.levelRotation} ${textPoint.x} ${textPoint.y})">${escapeHtml(level)}</text>`;
  }).join("");

  wheelNode.innerHTML = `
    <svg viewBox="${viewBoxMin} ${viewBoxMin} ${viewBoxSize} ${viewBoxSize}" role="img" aria-label="Centers of Expression wheel">
      <defs>${labelDefs}</defs>
      ${outerRing}
      ${baseSectors}
      ${valueSectors}
      ${ringGuides}
      ${radialBoundaries}
      ${ringLabels}
      ${levelLabels}
    </svg>
  `;
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

const CENTER_PATTERN_COLUMNS = [
  { patternKey: "action", listId: "centerTypicalActionList", icon: "→", defaultTone: "pos" },
  { patternKey: "thinking", listId: "centerTypicalThinkingList", icon: "◎", defaultTone: "inf" },
  { patternKey: "feeling", listId: "centerTypicalFeelingList", icon: "♥", defaultTone: "neu" },
];

const CENTER_NARRATIVE_SLOTS = [
  { patternKey: "action", id: "centerNarrativeBody", label: "Externalised Action" },
  { patternKey: "thinking", id: "centerNarrativeHead", label: "Internalised Thinking" },
  { patternKey: "feeling", id: "centerNarrativeHeart", label: "Externalised Feeling" },
];

function resolveCorePatternBulletsForRender(report) {
  return normalizeCorePatternBullets(
    Array.isArray(report?.corePatternBullets) && report.corePatternBullets.length
      ? report.corePatternBullets
      : [
          { key: "action", label: "Typical Action Patterns", text: report?.deep?.[0] || null },
          { key: "thinking", label: "Typical Thinking Patterns", text: report?.deep?.[1] || null },
          { key: "feeling", label: "Typical Feeling Patterns", text: report?.deep?.[2] || null },
        ],
  );
}

function resolveCenterPatternItems(corePatternBullets, patternKey, maxItems = 3) {
  const targetKey = String(patternKey || "").trim().toLowerCase();
  const matchedRow = (Array.isArray(corePatternBullets) ? corePatternBullets : []).find(
    (row) => String(row?.key || "").trim().toLowerCase() === targetKey,
  );
  const text = sanitizeCorePatternBulletText(matchedRow?.text);
  if (!text) return [];

  const inlineBulletItems = extractInlineCorePatternBulletItems(text, maxItems);
  if (inlineBulletItems.length) {
    return inlineBulletItems.slice(0, maxItems);
  }

  const narrativeItems = extractNarrativeBulletItems(text, maxItems)
    .map((item) => ensureSentenceStartsCapitalized(cleanPdfExtractedValue(item)))
    .filter(Boolean);
  if (narrativeItems.length) {
    return narrativeItems.slice(0, maxItems);
  }

  return [ensureSentenceStartsCapitalized(text)];
}

function renderCenterPatternRows(items, options = {}) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  const fallbackRows = rows.length ? rows : ["Not detected in assigned PDF."];
  const defaultTone = String(options?.defaultTone || "neu");
  const defaultIcon = String(options?.icon || "•");

  return fallbackRows
    .map((item) => {
      const text = ensureSentenceStartsCapitalized(formatOptionalText(item, "Not detected in assigned PDF."));
      if (!text) return "";
      const isNegative = /\b(?:not|dislike|weakness|forced|bribed|charmed|fear|angry|vulnerable|challenge)\b/i.test(text);
      const tone = isNegative ? "neg" : defaultTone;
      const icon = isNegative ? "!" : defaultIcon;
      return `<div class="ti"><div class="tic ${tone}">${escapeHtml(icon)}</div><div class="tt">${escapeHtml(text)}</div></div>`;
    })
    .filter(Boolean)
    .join("");
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

function extractInlineCorePatternBulletItems(text, maxItems = 10) {
  const normalized = sanitizeCorePatternBulletText(text);
  if (!normalized) return [];
  if (!/[•●▪◦·]/.test(normalized)) return [];

  const fromSplit = normalized
    .split(/[•●▪◦·]/g)
    .map((row) => ensureSentenceStartsCapitalized(cleanPdfExtractedValue(row)))
    .filter(Boolean)
    .filter((row) => row.length >= 12);
  if (fromSplit.length >= 2) {
    return Array.from(new Set(fromSplit)).slice(0, maxItems);
  }

  const fromSymbols = extractBulletItemsFromText(normalized, maxItems)
    .map((row) => ensureSentenceStartsCapitalized(cleanPdfExtractedValue(row)))
    .filter(Boolean);
  if (fromSymbols.length) {
    return Array.from(new Set(fromSymbols)).slice(0, maxItems);
  }

  return [];
}

function renderCorePatternBulletList(bullets) {
  const rows = normalizeCorePatternBullets(bullets);
  return rows
    .map((row) => {
      const label = formatOptionalText(row?.label, "Typical Pattern");
      const text = sanitizeCorePatternBulletText(row?.text) || "Not detected in assigned PDF.";
      const inlineBulletItems = extractInlineCorePatternBulletItems(text, 10);
      if (!inlineBulletItems.length) {
        return `<div class="ti"><div class="tic neu core-pattern-row-marker">•</div><div class="tt"><strong>${escapeHtml(label)}:</strong>&nbsp;${escapeHtml(text)}</div></div>`;
      }
      const inlineBulletListItems = inlineBulletItems
        .map((item) => `<li class="core-pattern-inline-item">${escapeHtml(item)}</li>`)
        .join("");
      return `<div class="ti"><div class="tic neu core-pattern-row-marker">•</div><div class="tt"><strong>${escapeHtml(label)}:</strong><ul class="core-pattern-inline-list">${inlineBulletListItems}</ul></div></div>`;
    })
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
  const collapsedLimit = 3;
  const points = extractFeedbackGuidancePoints(text, 6);
  if (!points.length) return escapeHtml("Not detected in assigned PDF.");
  const summary = summarizeSentence(points[0], 16);
  const visiblePoints = points.slice(0, collapsedLimit);
  const hiddenPoints = points.slice(collapsedLimit);
  const visibleBullets = buildAdaptiveListHtml(
    visiblePoints.map((point) => ({ tone: "neu", symbol: "•", text: point })),
  );
  if (!hiddenPoints.length) {
    return `<div data-feedback-guidance-cell="true" data-testid="feedback-guide-cell"><div style="margin-bottom:6px;font-size:12px;color:var(--text3)"><strong>Summary:</strong> ${escapeHtml(summary)}</div>${visibleBullets}</div>`;
  }
  const hiddenBullets = buildAdaptiveListHtml(
    hiddenPoints.map((point) => ({ tone: "neu", symbol: "•", text: point })),
  );
  console.log("[feedback-guide] rendering collapsed guidance cell", {
    visibleCount: visiblePoints.length,
    hiddenCount: hiddenPoints.length,
  });
  return `<div data-feedback-guidance-cell="true" data-testid="feedback-guide-cell"><div style="margin-bottom:6px;font-size:12px;color:var(--text3)"><strong>Summary:</strong> ${escapeHtml(summary)}</div><div data-feedback-guidance-primary="true">${visibleBullets}</div><div data-feedback-guidance-extra="true" style="display:none;margin-top:4px">${hiddenBullets}</div><button type="button" onclick="toggleFeedbackGuidanceExpansion(this)" data-feedback-guidance-toggle="collapsed" data-testid="feedback-guide-expand-button" aria-expanded="false" style="margin-top:8px;padding:0;background:none;border:none;color:var(--primary);font-size:12px;font-weight:400;cursor:pointer">Show more</button></div>`;
}

function toggleFeedbackGuidanceExpansion(button) {
  if (!button) return;
  const parentCell = button.closest('[data-feedback-guidance-cell="true"]');
  if (!parentCell) return;
  const extraRows = parentCell.querySelector('[data-feedback-guidance-extra="true"]');
  if (!extraRows) return;
  const isExpanded = button.getAttribute("data-feedback-guidance-toggle") === "expanded";
  if (isExpanded) {
    extraRows.style.display = "none";
    button.setAttribute("data-feedback-guidance-toggle", "collapsed");
    button.setAttribute("aria-expanded", "false");
    button.textContent = "Show more";
    console.log("[feedback-guide] collapsed extra guidance bullets");
    return;
  }
  extraRows.style.display = "block";
  button.setAttribute("data-feedback-guidance-toggle", "expanded");
  button.setAttribute("aria-expanded", "true");
  button.textContent = "Show less";
  console.log("[feedback-guide] expanded extra guidance bullets");
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
      const bulletRows = text
        .split(/(?:\s*[•▪◦]\s*|\s*\n+\s*|(?<=[.!?])\s+(?=[A-Z0-9]))/g)
        .map((row) => ensureSentenceStartsCapitalized(String(row || "").trim()))
        .filter(Boolean);
      const textMarkup = bulletRows.length >= 2
        ? `<ul class="dev-item-list">${bulletRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`
        : `<p>${escapeHtml(text)}</p>`;
      const source = sanitizeSnippet(formatOptionalText(path?.source, ""), "");
      const showSource = Boolean(source) && !/extracted\s+from\s+assigned\s+pdf/i.test(source);
      return `<div class="dev-item"><div class="dev-item-title">${escapeHtml(title)}</div>${textMarkup}${showSource ? `<div class="subh" style="margin:8px 0 0">${escapeHtml(source)}</div>` : ""}</div>`;
    })
    .join("");
}

function normalizeDevelopmentExerciseGridItems(exercises, maxItems = 20) {
  const safeExercises = Array.isArray(exercises) ? exercises : [];
  const out = [];
  const seen = new Set();
  const max = Number.isFinite(Number(maxItems)) ? Math.max(1, Number(maxItems)) : 20;

  for (const entry of safeExercises) {
    const rawText = ensureSentenceStartsCapitalized(
      cleanPdfExtractedValue(String(entry?.text ?? entry ?? "")),
    );
    if (!rawText || isMissingExtractedText(rawText)) continue;
    const key = normalizeExtractedText(rawText).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: `Exercise ${out.length + 1}`,
      text: rawText,
    });
    if (out.length >= max) break;
  }

  if (!out.length) {
    return [{ title: "Exercise 1", text: "Not detected in assigned PDF." }];
  }
  return out;
}

function renderDevelopmentExerciseGridItems(exercises) {
  const normalized = normalizeDevelopmentExerciseGridItems(exercises, 20);
  const html = buildDevExercisePathHtml(normalized);
  console.log("[development-exercises] grid hydrated", {
    count: normalized.length,
  });
  return html || '<div class="dev-item"><div class="dev-item-title">Exercise 1</div><p>Not detected in assigned PDF.</p></div>';
}

function buildDevExerciseComponentData(report) {
  const typeLabel = `Type ${String(report?.typeNumber || "?")}`;
  const supportsIntegrationLevel = report?.supportsIntegrationLevel !== false;
  const integrationLevel = supportsIntegrationLevel
    ? normalizeIntegrationLevel(report?.integration)
    : null;
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
      text: supportsIntegrationLevel
        ? (integrationPriority[integrationLevel] || integrationPriority.Moderate)
        : "Integration level is not available in this STD report. Focus on steady, repeatable regulation habits and clear communication checks.",
      source: supportsIntegrationLevel
        ? `Integration signal: ${integrationLevel.toUpperCase()}`
        : "Integration signal unavailable for STD report",
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

  const mergedPaths = [...generatedPaths];
  const deduped = [];
  const seenTexts = new Set();
  for (const item of mergedPaths) {
    const key = normalizeExtractedText(item?.text || "").toLowerCase();
    if (!key || seenTexts.has(key)) continue;
    seenTexts.add(key);
    deduped.push(item);
    if (deduped.length >= 6) break;
  }

  const summary = supportsIntegrationLevel
    ? `${typeLabel} growth path currently prioritizes ${integrationLevel.toUpperCase()} integration behaviors with ${overallStrainLevel.toUpperCase()} strain recovery tactics.`
    : `${typeLabel} growth path currently prioritizes strain recovery and steady behavioral consistency because integration level is not available in this STD report.`;
  console.log("[dev-exercise] built component data", {
    typeLabel,
    integrationLevel,
    supportsIntegrationLevel,
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
  const supportsIntegrationLevel = report?.supportsIntegrationLevel !== false;
  const integrationLevel = supportsIntegrationLevel
    ? normalizeIntegrationLevel(report?.integration)
    : null;
  const developingAsFallbackCopy = firstPresentSnippet(
    [report?.motivation2, report?.giftsDesc],
    "Development guidance was not detected in the assigned PDF.",
  );
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
    developingAsCopy: developingAsFallbackCopy,
    developingAsBullets: extractNarrativeBulletItems(developingAsFallbackCopy, 8),
    bodyLanguageRows: fallbackBodyLanguageRows,
    conflictResponseCopy: `Conflict response often reflects your ${formatOptionalText(report?.conflictStyle, "adaptive")} style under pressure.`,
    conflictTriggeredCopy: "When triggered, slowing the reaction cycle and naming impact improves outcomes.",
    conflictTriggeredBullets: ["When triggered, slowing the reaction cycle and naming impact improves outcomes."],
    centeredDecisionCopy: `Decisions often center through your ${centerLabel} perspective before balancing the other centers.`,
    decisionImpactCopy: `Your style can influence decisions through ${formatOptionalText(report?.focus, "focused pattern recognition")} and fast priority weighting.`,
    decisionStrainCopy: supportsIntegrationLevel
      ? `At ${integrationLevel.toUpperCase()} integration, strain effects can amplify speed and certainty while reducing collaboration signals.`
      : "Integration level is not available in this STD report, so focus on observed strain signals and collaborative pacing in decisions.",
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

  const source = String(text || "");
  const hasExplicitBulletSymbols = /[•●▪◦·]/.test(source);
  const extractedRows = extractBulletItemsFromText(normalized, maxItems)
    .map((row) => cleanPdfExtractedValue(row))
    .filter(Boolean);
  if (hasExplicitBulletSymbols && extractedRows.length) {
    return Array.from(new Set(extractedRows)).slice(0, maxItems);
  }
  if (extractedRows.length > 1) {
    return Array.from(new Set(extractedRows)).slice(0, maxItems);
  }

  const cueSplitPattern =
    /\s+(?=(?:Quick|Able|Preference|Willingness|Your|You|At|Be|Consider|As|Make|Watch|Not|Forthright|Comfortably|Willing(?:ly)?|Reluctant|Demanding|Very|Have|Miss|Try|Hold|Vacillate)\b)/g;
  const cueRows = normalized
    .split(cueSplitPattern)
    .map((row) => cleanPdfExtractedValue(row))
    .filter(Boolean)
    .filter((row) => row.length >= 18);
  if (cueRows.length >= 2) return Array.from(new Set(cueRows)).slice(0, maxItems);

  const sentenceRows = normalized
    .split(/(?<=[.?!])\s+/)
    .map((row) => cleanPdfExtractedValue(row))
    .filter(Boolean)
    .filter((row) => row.length >= 18);
  if (sentenceRows.length >= 2) return Array.from(new Set(sentenceRows)).slice(0, maxItems);
  if (extractedRows.length) return Array.from(new Set(extractedRows)).slice(0, maxItems);

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

function getWingTypeNumbers(typeNumberRaw) {
  const numericType = Number.parseInt(String(typeNumberRaw || ""), 10);
  if (!Number.isFinite(numericType) || numericType < 1 || numericType > 9) {
    return { leftWing: 9, rightWing: 1 };
  }
  return {
    leftWing: numericType === 1 ? 9 : numericType - 1,
    rightWing: numericType === 9 ? 1 : numericType + 1,
  };
}

function renderWingInfluencePanel(report, integrationLevelRaw) {
  const headingNode = document.getElementById("wingInfluenceHeading");
  const gridNode = document.getElementById("wingInfluenceGrid");
  if (!headingNode || !gridNode) return;

  const typeNumber = String(report?.typeNumber || "").trim();
  const normalizedIntegrationLevel = normalizeIntegrationLevel(integrationLevelRaw);
  const { leftWing, rightWing } = getWingTypeNumbers(typeNumber);
  const leftWingTypeName = formatOptionalText(REPORT_EXAMPLES?.[String(leftWing)]?.typeName, "Wing");
  const rightWingTypeName = formatOptionalText(REPORT_EXAMPLES?.[String(rightWing)]?.typeName, "Wing");
  headingNode.textContent = `Wing Influence — Types ${leftWing} & ${rightWing}`;
  gridNode.innerHTML = `
    <div data-testid="wing-influence-left">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:32px;height:32px;border-radius:50%;background:var(--gold-lt);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:17px;font-weight:700;color:var(--gold)">${leftWing}</div><div><div style="font-size:13px;font-weight:600">Wing ${leftWing}</div><div style="font-size:11px;color:var(--text3)">${normalizedIntegrationLevel} integration</div></div></div>
      <div class="wing-item">Type ${typeNumber} can borrow steadiness and perspective from Type ${leftWing} (${escapeHtml(leftWingTypeName)}).</div>
      <div class="wing-item">At ${normalizedIntegrationLevel.toLowerCase()} integration, this wing is most useful when balancing your default style under pressure.</div>
    </div>
    <div data-testid="wing-influence-right">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:32px;height:32px;border-radius:50%;background:var(--blue-lt);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:17px;font-weight:700;color:var(--blue)">${rightWing}</div><div><div style="font-size:13px;font-weight:600">Wing ${rightWing}</div><div style="font-size:11px;color:var(--text3)">${normalizedIntegrationLevel} integration</div></div></div>
      <div class="wing-item">Type ${typeNumber} can also draw initiative and expression from Type ${rightWing} (${escapeHtml(rightWingTypeName)}).</div>
      <div class="wing-item">Use this wing to broaden your range while keeping communication clear and collaborative.</div>
    </div>
  `;
  console.log("[integration] rendered wing influence panel", {
    typeNumber,
    leftWing,
    rightWing,
    integrationLevel: normalizedIntegrationLevel,
  });
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
  const normalized = cleaned.replace(/^\s*[-–—.,;:!?]+\s*(?=[A-Za-z])/, "");
  let output = "";
  let shouldCapitalize = true;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (shouldCapitalize && /[a-z]/.test(char)) {
      output += char.toUpperCase();
      shouldCapitalize = false;
      continue;
    }

    output += char;

    if (/[A-Za-z0-9]/.test(char)) {
      shouldCapitalize = false;
      continue;
    }

    if (/[.!?]/.test(char) || char === "\n" || char === "\r") {
      shouldCapitalize = true;
      continue;
    }

    if (char === "•" || char === "·" || char === "▪" || char === "◦" || char === "-" || char === "*") {
      const previous = normalized[index - 1] || "";
      const next = normalized[index + 1] || "";
      if ((!previous || /\s/.test(previous)) && (!next || /\s/.test(next))) {
        shouldCapitalize = true;
      }
    }
  }

  return output;
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
    if (bulletNarrative && !isLowQualityStrainNarrative(bulletNarrative, category)) {
      return { category, text: bulletNarrative };
    }

    const levelPattern = new RegExp(
      `perceived\\s+level\\s+of\\s+${escapeRegex(category)}\\s+strain\\s+is\\s+(LOW|MEDIUM|HIGH)\\.?([\\s\\S]{0,520}?)(?=Ben\\s+your\\s+perceived\\s+level\\s+of\\s+|The\\s+lines\\s+connecting|$)`,
      "i",
    );
    const levelMatch = strainBlock.match(levelPattern);
    if (levelMatch) {
      const prefix = `${category} strain is ${String(levelMatch[1] || "").toUpperCase()}.`;
      const detail = cleanPdfExtractedValue(levelMatch[2] || "");
      const combined = cleanPdfExtractedValue(`${prefix} ${detail}`) || prefix;
      if (!isLowQualityStrainNarrative(combined, category)) {
        return { category, text: combined };
      }
    }

    const nextLabels = categories.slice(index + 1);
    const nextBoundary = nextLabels.length ? `(?:${nextLabels.map(escapeRegex).join("|")})\\b` : "$";
    const pattern = new RegExp(`${escapeRegex(category)}\\s*[:\\-]?\\s*([\\s\\S]{10,280}?)(?=\\s*${nextBoundary})`, "i");
    const match = strainBlock.match(pattern);
    const textCandidate =
      cleanPdfExtractedValue(match?.[1] || "") ||
      extractSnippetFromLabels(strainBlock, [category, `${category} Strain`]) ||
      extractSnippetFromLabels(pdfText, [category, `${category} Strain`]);
    const text =
      textCandidate && !isLowQualityStrainNarrative(textCandidate, category)
        ? textCandidate
        : "Not detected in assigned PDF.";
    return { category, text };
  });
}

function summarizeOverallStrainText(rawText, options = {}) {
  const rawMaxWords = Number(options?.maxWords);
  const hasWordLimit = Number.isFinite(rawMaxWords) && rawMaxWords > 0;
  const maxWords = hasWordLimit ? Math.max(12, Math.min(220, rawMaxWords)) : null;
  let normalized = normalizeExtractedText(rawText || "");
  if (!normalized) return null;

  const preferredLeadMatch = normalized.match(/\bYour\s+strain\s+profile\s+provides\b/i);
  if (preferredLeadMatch && Number.isFinite(Number(preferredLeadMatch.index))) {
    const leadIndex = Number(preferredLeadMatch.index);
    if (leadIndex > 0) normalized = normalizeExtractedText(normalized.slice(leadIndex));
  }

  const overallSpilloverBoundary = normalized.match(
    /\b(?:DEVELOPMENT\s*EXERCISE(?:S)?|Ben\s+your\s+perceived\s+level\s+of\s+(?:Vocational|Environmental|Physical|Interpersonal|Psychological|Happiness)\s+strain|(?:Vocational|Environmental|Physical|Interpersonal|Psychological|Happiness)\s+Strain)\b/i,
  );
  if (overallSpilloverBoundary?.index > 0) {
    console.log("[strain] trimming overall summary spillover boundary", {
      boundary: cleanPdfExtractedValue(overallSpilloverBoundary?.[0] || ""),
      boundaryIndex: Number(overallSpilloverBoundary.index),
    });
    normalized = normalizeExtractedText(normalized.slice(0, overallSpilloverBoundary.index));
  }
  if (!normalized) return null;

  const explicit = normalized.match(
    /overall\s+strain(?:\s+level)?\s*(?:is|appears|rated|of|at|was)?\s*(?:LOW|MEDIUM|HIGH|MODERATE)?\s*[:\-]?\s*([\s\S]{24,2200})/i,
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
    .replace(
      /\bBen\s+your\s+perceived\s+level\s+of\s+(?:Vocational|Environmental|Physical|Interpersonal|Psychological|Happiness)\s+strain[\s\S]*$/i,
      "",
    )
    .replace(
      /\b(?:Vocational|Environmental|Physical|Interpersonal|Psychological|Happiness)\s+Strain\b[\s\S]*$/i,
      "",
    )
    .replace(/\bDEVELOPMENT\s*EXERCISE(?:S)?\b[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!summary) return null;

  if (!/[.!?]["')\]]?$/.test(summary)) {
    const lastSentenceStop = Math.max(summary.lastIndexOf("."), summary.lastIndexOf("!"), summary.lastIndexOf("?"));
    if (lastSentenceStop >= 40) {
      const trimmedSummary = summary.slice(0, lastSentenceStop + 1).trim();
      if (trimmedSummary && trimmedSummary !== summary) {
        console.log("[strain] trimmed incomplete overall summary tail", {
          originalLength: summary.length,
          trimmedLength: trimmedSummary.length,
        });
        summary = trimmedSummary;
      }
    }
  }

  if (Number.isFinite(maxWords) && maxWords > 0) {
    const words = summary.split(/\s+/).filter(Boolean);
    if (words.length > maxWords) {
      summary = words.slice(0, maxWords).join(" ");
    }
  }
  return summary;
}

function extractOverallStrainSummaryFromLlmProfile(parsedProfile) {
  const overallFromAttachedProfile = parsedProfile?.attachedProfile?.strain_profile?.overall;
  const overallFromAttachedProfileCamel = parsedProfile?.attachedProfile?.strainProfile?.overall;
  const overallCandidates = [
    parsedProfile?.overallStrainSummary,
    parsedProfile?.strainProfile?.overall?.summary,
    parsedProfile?.strain_profile?.overall?.summary,
    parsedProfile?.attachedProfile?.strain_profile?.overall?.summary,
    parsedProfile?.attachedProfile?.strainProfile?.overall?.summary,
    typeof overallFromAttachedProfile === "string" ? overallFromAttachedProfile : null,
    typeof overallFromAttachedProfileCamel === "string" ? overallFromAttachedProfileCamel : null,
  ];

  for (const candidate of overallCandidates) {
    const normalizedSummary = summarizeOverallStrainText(candidate, { maxWords: 0 });
    if (normalizedSummary) return normalizedSummary;
  }
  return null;
}

function hasOverallStrainBoundarySpillover(value) {
  const normalized = normalizeExtractedText(value || "");
  if (!normalized) return false;
  return /\bDEVELOPMENT\s*EXERCISE(?:S)?\b|\b(?:Vocational|Environmental|Physical|Interpersonal|Psychological|Happiness)\s+Strain\b/i.test(
    normalized,
  );
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
  return summarizeOverallStrainText(summarySource, { maxWords: 0 });
}

function extractOverallStrainSummaryFromPdfText(pdfText) {
  const normalized = normalizeExtractedText(pdfText || "");
  if (!normalized) return null;
  const overallBlock = normalized.match(
    /Overall\s*Strain[\s\S]{24,1800}(?=\b(?:Vocational|Environmental|Physical|Interpersonal|Psychological|Happiness)\s+Strain\b|$)/i,
  );
  return summarizeOverallStrainText(overallBlock?.[0] || normalized, { maxWords: 0 });
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
  if (hasExcessiveSymbolNoise(normalized)) return true;

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
    environmental: [20],
    physical: [20, 21],
    interpersonal: [20, 21],
    psychological: [21, 22],
    happiness: [22],
  },
  communication: [24],
  feedbackGuide: [28, 29],
  developmentExercises: [7, 11, 13, 17, 19, 28, 31, 36, 38],
};

const ASSIGNED_PDF_INSTRUCTION_RULES = {
  typicalActionPatterns: {
    pageNumbers: [6, 7],
    startAnchor: "Typical Action Patterns",
    endAnchor: "Typical Thinking Patterns",
    preferHeadingStart: true,
    mode: "single_snippet",
  },
  typicalThinkingPatterns: {
    pageNumbers: [6, 7],
    startAnchor: "Typical Thinking Patterns",
    endAnchor: "Typical Feeling Patterns",
    preferHeadingStart: true,
    mode: "single_snippet",
  },
  typicalFeelingPatterns: {
    pageNumbers: [6, 7],
    startAnchor: "Typical Feeling Patterns",
    endAnchor: "Blind Spots",
    endAnchors: [
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
    ],
    preferHeadingStart: true,
    preferHeadingEnd: true,
    mode: "single_snippet",
  },
  motivationSummary: {
    pageNumbers: [6],
    startAnchor: "Motivation",
    endAnchor: "Typical Action Patterns",
    mode: "single_snippet",
  },
  instinctGoals: {
    pageNumbers: [10],
    startAnchor: "Definitions of the three instinctual goals",
    endAnchor: "end of page",
    preferHeadingStart: true,
    mode: "full_page",
  },
  instinctGoalOneOnOne: {
    pageNumbers: [10],
    startAnchor: "One-On-One - SX",
    endAnchor: "Social - SO",
    preferHeadingStart: true,
    mode: "single_snippet",
  },
  instinctGoalSocial: {
    pageNumbers: [10],
    startAnchor: "Social - SO",
    endAnchor: "Self-Preservation - SP",
    preferHeadingStart: true,
    mode: "single_snippet",
  },
  instinctGoalSelfPres: {
    pageNumbers: [10],
    startAnchor: "Self-Preservation - SP",
    endAnchor: "end of page",
    endAnchors: ["27 Subtypes & Instincts", "27 Subtypes", "Centers of Expression", "Center of Expression"],
    limitToStartPage: true,
    preferHeadingStart: true,
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
  conflictDevelopmentGoals: {
    pageNumbers: [31],
    startAnchor: "Development goals",
    endAnchor: "end of page",
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
    pageNumbers: [18],
    startAnchor: "Your strain profile provides",
    endAnchor: "Ben your perceived level of Vocational strain",
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
    pageNumbers: [20],
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
    pageNumbers: [22],
    startAnchor: "Ben your perceived level of Happiness strain",
    endAnchor: "end of page",
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

function createInstructionExtractionEngine(parsedProfile) {
  const pageTextMap = getReportPageTextByNumber(parsedProfile);
  const availablePages = Array.from(pageTextMap.keys()).sort((a, b) => a - b);
  return {
    pageTextMap,
    availablePages,
  };
}

function getInstructionExtractionEngine(parsedProfile) {
  if (!parsedProfile || typeof parsedProfile !== "object") {
    return createInstructionExtractionEngine(parsedProfile);
  }
  if (INSTRUCTION_EXTRACTION_ENGINE_CACHE.has(parsedProfile)) {
    return INSTRUCTION_EXTRACTION_ENGINE_CACHE.get(parsedProfile);
  }
  const engine = createInstructionExtractionEngine(parsedProfile);
  INSTRUCTION_EXTRACTION_ENGINE_CACHE.set(parsedProfile, engine);
  return engine;
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
  const instructionEngine = getInstructionExtractionEngine(parsedProfile);
  const pageTextMap = instructionEngine?.pageTextMap instanceof Map
    ? instructionEngine.pageTextMap
    : new Map();
  const availablePages = Array.isArray(instructionEngine?.availablePages)
    ? instructionEngine.availablePages
    : Array.from(pageTextMap.keys()).sort((a, b) => a - b);
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
  const useEndOfPageBoundary = endAnchor === "end_of_page";
  const limitToStartPage = useEndOfPageBoundary && Boolean(safeRule.limitToStartPage);
  const endAnchors = Array.from(new Set([
    endAnchor,
    ...(Array.isArray(safeRule.endAnchors) ? safeRule.endAnchors.map((anchor) => normalizeInstructionAnchor(anchor)) : []),
  ])).filter((anchor) => anchor && anchor !== "end_of_page");
  const includeStartAnchor = Boolean(options?.includeStartAnchor ?? safeRule.includeStartAnchor);
  const includeEndAnchor = Boolean(options?.includeEndAnchor ?? safeRule.includeEndAnchor);
  const shouldRequireStartAnchor = Boolean(startAnchor && startAnchor !== "end_of_page");

  const extractFromSource = (sourceText) => {
    const source = String(sourceText || "").trim();
    if (!source) return null;
    let startIndex = 0;
    let startMatched = !shouldRequireStartAnchor;
    if (startAnchor) {
      let startMatch = findInstructionAnchorMatch(source, startAnchor, {
        startIndex: 0,
        preferHeading: Boolean(safeRule.preferHeadingStart),
      });
      if (!startMatch && Boolean(safeRule.preferHeadingStart)) {
        startMatch = findInstructionAnchorMatch(source, startAnchor, {
          startIndex: 0,
          preferHeading: false,
        });
      }
      if (startMatch) {
        startMatched = true;
        startIndex = includeStartAnchor ? startMatch.index : startMatch.index + startMatch.length;
      }
    }
    if (!startMatched) return null;

    let endIndex = source.length;
    endAnchors.forEach((anchor) => {
      const endMatch = findInstructionAnchorMatch(source, anchor, {
        startIndex,
        preferHeading: Boolean(safeRule.preferHeadingEnd),
      });
      if (!endMatch) return;
      const candidateEndIndex = includeEndAnchor ? endMatch.index + endMatch.length : endMatch.index;
      if (candidateEndIndex >= startIndex && candidateEndIndex < endIndex) {
        endIndex = candidateEndIndex;
      }
    });
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
      (limitToStartPage ? pageSegments.slice(startIndex, startIndex + 1) : pageSegments.slice(startIndex))
        .map((segment) => segment.text)
        .join("\n\n"),
    );
    if (snippet) return snippet;
  }

  const fallback = extractFromSource(
    (limitToStartPage ? pageSegments.slice(0, 1) : pageSegments)
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

function extractCorePatternBulletsFromReportContent(parsedProfile) {
  const actionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.typicalActionPatterns,
  );
  const thinkingText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.typicalThinkingPatterns,
  );
  const feelingText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.typicalFeelingPatterns,
  );

  return normalizeCorePatternBullets([
    { key: "action", label: "Typical Action Patterns", text: actionText || null },
    { key: "thinking", label: "Typical Thinking Patterns", text: thinkingText || null },
    { key: "feeling", label: "Typical Feeling Patterns", text: feelingText || null },
  ]);
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
  const boundaryStagePattern = boundaryStages.map((value) => buildFlexiblePhrasePattern(value)).join("|");
  const boundaryPattern = boundaryStages.length
    ? `${boundaryStagePattern}|coaching\\s*relationship|strategic\\s*leadership|decision\\s*making|$`
    : "coaching\\s*relationship|strategic\\s*leadership|decision\\s*making|$";
  const disallowedStageLead = boundaryStagePattern ? `[-–—\\s]*(?:${boundaryStagePattern})\\b` : "";

  const stripOverviewPreamble = (value) => {
    let candidate = cleanPdfExtractedValue(value || "");
    if (!candidate) return null;
    if (boundaryStages.length) {
      const escapedBoundary = boundaryStages.map((nextStage) => escapeRegex(nextStage)).join("|");
      const overviewPattern = new RegExp(
        `^(?:${escapedBoundary})(?:\\s*[-–—/]\\s*(?:${escapedBoundary})){1,4}\\s*,?\\s*(?:illustrate|illustrates|show|shows|describe|describes|represent|represents)?[^.?!]{0,240}[.?!]?\\s*`,
        "i",
      );
      candidate = candidate.replace(overviewPattern, "").trim();
    }
    candidate = candidate
      .replace(new RegExp(`^${escapeRegex(stage)}\\s*[:\\-]?\\s*`, "i"), "")
      .trim();
    return candidate || null;
  };

  const blockPattern = new RegExp(
    `${buildFlexiblePhrasePattern(stage)}\\s*[:\\-]?\\s*${disallowedStageLead ? `(?!${disallowedStageLead})` : ""}([\\s\\S]{22,840}?)(?=\\s*(?:${boundaryPattern}))`,
    "i",
  );
  const blockMatch = normalized.match(blockPattern);
  const direct = stripOverviewPreamble(blockMatch?.[1] || "");
  if (direct) return direct;

  const fallback = extractSnippetFromLabels(normalized, [stage]);
  return stripOverviewPreamble(fallback || "") || null;
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

function extractCoreIdentityFromTargetedSections(parsedProfile) {
  const targeted = getTargetedSections(parsedProfile);
  const coreIdentity = targeted?.core_identity && typeof targeted.core_identity === "object"
    ? targeted.core_identity
    : {};
  const coreBeliefAndAttention = targeted?.core_belief_attention_pattern &&
      typeof targeted.core_belief_attention_pattern === "object"
    ? targeted.core_belief_attention_pattern
    : {};
  const coreType = targeted?.core_type && typeof targeted.core_type === "object"
    ? targeted.core_type
    : {};
  const subtype = targeted?.subtype && typeof targeted.subtype === "object"
    ? targeted.subtype
    : {};

  const pickIdentityText = (candidates, maxLength = 420) => {
    const rows = Array.isArray(candidates) ? candidates : [candidates];
    for (const candidate of rows) {
      const text = compactTargetedSectionText(candidate, { maxItems: 6, maxLength });
      if (text && !isMissingExtractedText(text)) return text;
    }
    return null;
  };

  const result = {
    coreFear: pickIdentityText([
      coreIdentity?.core_fear,
      coreIdentity?.basic_fear,
      coreType?.core_fear,
      coreType?.basic_fear,
      subtype?.core_fear,
    ]),
    basicDesire: pickIdentityText([
      coreIdentity?.basic_desire,
      coreIdentity?.core_desire,
      coreType?.basic_desire,
      coreType?.core_desire,
      subtype?.basic_desire,
      subtype?.core_desire,
      coreIdentity?.gifts,
      coreType?.gifts,
    ]),
    passion: pickIdentityText([
      coreIdentity?.passion,
      coreType?.passion,
      subtype?.passion,
      coreIdentity?.vices,
      coreType?.vices,
    ]),
    selfTalk: pickIdentityText([
      coreIdentity?.self_talk,
      coreIdentity?.meta_message,
      coreBeliefAndAttention?.self_talk,
      coreBeliefAndAttention?.meta_message,
      coreType?.self_talk,
      subtype?.self_talk,
    ], 320),
    worldview: pickIdentityText([
      coreIdentity?.worldview,
      coreBeliefAndAttention?.worldview,
      coreBeliefAndAttention?.core_belief,
      coreType?.worldview,
      subtype?.worldview,
    ]),
    focus: pickIdentityText([
      coreIdentity?.focus_of_attention,
      coreIdentity?.focus,
      coreBeliefAndAttention?.focus_of_attention,
      coreBeliefAndAttention?.focus,
      coreType?.focus_of_attention,
      coreType?.focus,
      subtype?.focus_of_attention,
      subtype?.focus,
    ]),
  };

  console.log("[core-identity] targeted-section extraction", {
    hasCoreFear: Boolean(result.coreFear),
    hasBasicDesire: Boolean(result.basicDesire),
    hasPassion: Boolean(result.passion),
    hasSelfTalk: Boolean(result.selfTalk),
    hasWorldview: Boolean(result.worldview),
    hasFocus: Boolean(result.focus),
  });

  if (Object.values(result).every((value) => !value)) return null;
  return result;
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

function extractStrainQualitativeFromTargetedSections(parsedProfile) {
  const targetedStrain =
    getTargetedSections(parsedProfile)?.strain_interpretation &&
    typeof getTargetedSections(parsedProfile)?.strain_interpretation === "object"
      ? getTargetedSections(parsedProfile).strain_interpretation
      : null;
  if (!targetedStrain) return [];

  const categoryKeyMap = {
    Happiness: "happiness",
    Vocational: "vocational",
    Interpersonal: "interpersonal",
    Physical: "physical",
    Environmental: "environmental",
    Psychological: "psychological",
  };
  const categories = ["Happiness", "Vocational", "Interpersonal", "Physical", "Environmental", "Psychological"];
  const rows = categories.map((category) => ({
    category,
    text:
      compactTargetedSectionText(targetedStrain?.[categoryKeyMap[category]], {
        maxItems: 8,
        maxLength: 420,
      }) || "Not detected in structured report content.",
  }));

  console.log("[strain] targeted-section extraction", {
    populatedRows: rows.filter((row) => !isMissingExtractedText(row?.text)).length,
  });
  return rows;
}

function extractOverallStrainSummaryFromTargetedSections(parsedProfile) {
  const targetedStrain =
    getTargetedSections(parsedProfile)?.strain_interpretation &&
    typeof getTargetedSections(parsedProfile)?.strain_interpretation === "object"
      ? getTargetedSections(parsedProfile).strain_interpretation
      : null;
  if (!targetedStrain) return null;
  const rows = normalizeTargetedSectionRows(targetedStrain?.overall, { maxItems: 4, maxLength: 1600 });
  if (!rows.length) return null;
  return summarizeOverallStrainText(rows.join(" "), { maxWords: 0 });
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
  const targetedCoreIdentity = extractCoreIdentityFromTargetedSections(parsedProfile);
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
  const instinctGoalsSource = targeted?.subtypes_instincts && typeof targeted.subtypes_instincts === "object"
    ? targeted.subtypes_instincts
    : (targeted?.instinct_goals && typeof targeted.instinct_goals === "object"
        ? targeted.instinct_goals
        : {});

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
  const developingRows = normalizeTargetedSectionRows(development.subtype, { maxItems: 8, maxLength: 220 });
  const targetedMotivationSummary = compactTargetedSectionText([
    targeted?.core_type?.motivation,
    targeted?.core_type?.motivations,
    targeted?.subtype?.motivation,
    targetedCoreIdentity?.basicDesire,
    targetedCoreIdentity?.coreFear,
    targetedCoreIdentity?.passion,
  ], { maxItems: 6, maxLength: 420 });
  const instinctGoals = {
    selfPres: compactTargetedSectionText([
      instinctGoalsSource?.self_preservation,
      instinctGoalsSource?.self_pres,
      instinctGoalsSource?.sp,
      instinctGoalsSource?.selfPres,
    ], { maxItems: 4, maxLength: 1200 }),
    social: compactTargetedSectionText([
      instinctGoalsSource?.social,
      instinctGoalsSource?.so,
    ], { maxItems: 4, maxLength: 1200 }),
    oneOnOne: compactTargetedSectionText([
      instinctGoalsSource?.one_on_one,
      instinctGoalsSource?.oneOnOne,
      instinctGoalsSource?.sexual,
      instinctGoalsSource?.sx,
    ], { maxItems: 4, maxLength: 1200 }),
  };
  const hasInstinctGoals = Boolean(instinctGoals.selfPres || instinctGoals.social || instinctGoals.oneOnOne);

  const focused = {
    motivationSummary: targetedMotivationSummary,
    instinctGoals: hasInstinctGoals ? instinctGoals : null,
    developingAsCopy: compactTargetedSectionText(developingRows, { maxItems: 8, maxLength: 420 }),
    developingAsBullets: developingRows,
    bodyLanguageRows: normalizeTargetedSectionRows(targeted.body_language, { maxItems: 10, maxLength: 210 }),
    conflictResponseCopy: compactTargetedSectionText(conflictRows.slice(0, 5), { maxItems: 5, maxLength: 420 }),
    conflictTriggeredCopy: compactTargetedSectionText(conflictRows, { maxItems: 8, maxLength: 420 }),
    conflictTriggeredBullets: conflictRows,
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
    developingAsBullets: focused.developingAsBullets.length,
    bodyLanguageRows: focused.bodyLanguageRows.length,
    hasConflictResponse: Boolean(focused.conflictResponseCopy),
    conflictTriggeredBullets: focused.conflictTriggeredBullets.length,
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

function extractMotivationalNeedSummary(rawText, maxLength = 420) {
  const normalized = normalizeExtractedText(rawText || "");
  if (!normalized) return null;

  const clampLength = Number.isFinite(Number(maxLength)) ? Number(maxLength) : 420;
  const cap = Math.max(120, Math.min(1200, clampLength));
  const cleanCandidate = (value) => {
    const cleaned = cleanPdfExtractedValue(value || "")
      .replace(/^Motivation\s*[:\-]?\s*/i, "")
      .trim();
    if (!cleaned) return null;
    if (cleaned.length <= cap) return cleaned;
    return `${cleaned.slice(0, cap).trim()}...`;
  };

  const explicitPatterns = [
    /\b(This\s+style\s+stems\s+from\s+the\s+motivational\s+need\s+to\s+[^.?!]{10,360}[.?!]?)/i,
    /\b(This\s+style\s+is\s+motivated\s+by\s+[^.?!]{10,360}[.?!]?)/i,
    /\b(motivational\s+need\s+to\s+[^.?!]{10,300}[.?!]?)/i,
    /\b(motivated\s+by\s+[^.?!]{10,300}[.?!]?)/i,
  ];
  for (const pattern of explicitPatterns) {
    const match = normalized.match(pattern);
    const cleaned = cleanCandidate(match?.[1] || match?.[0] || "");
    if (cleaned) return cleaned;
  }

  const motivationBlockMatch = normalized.match(
    /\bMotivation\b\s*[:\-]?\s*([\s\S]{18,760}?)(?=\b(?:Typical\s+Action\s+Patterns|Typical\s+Thinking\s+Patterns|Typical\s+Feeling\s+Patterns|Blind\s+Spots|Worldview|Focus\s+of\s+Attention|Core\s+Fear|Self[-\s]*Talk|Gifts|Vices)\b|$)/i,
  );
  const motivationBlock = motivationBlockMatch?.[1] || "";
  if (!motivationBlock) return null;

  const sentenceCandidates = (motivationBlock.match(/[^.!?]{12,320}(?:[.!?]|$)/g) || [])
    .map((sentence) => cleanCandidate(sentence))
    .filter(Boolean);
  const prioritizedSentence =
    sentenceCandidates.find((sentence) => /\bmotivational\s+need\b/i.test(sentence)) ||
    sentenceCandidates.find((sentence) => /\bmotivated\s+by\b/i.test(sentence)) ||
    sentenceCandidates[0] ||
    null;
  return prioritizedSentence;
}

function extractInstinctGoalDefinitions(rawText) {
  const normalized = normalizeExtractedText(rawText || "");
  if (!normalized) return null;
  const defaultStopLabels = [
    "27 Subtypes & Instincts",
    "27 Subtypes",
    "Centers of Expression",
    "Center of Expression",
    "Thinking Center of Expression",
    "Action Center of Expression",
    "Feeling Center of Expression",
    "Development Exercise",
    "Copyright",
  ];
  const segmentFor = (labels, stopLabels = []) => {
    const startPattern = labels.map((value) => buildFlexiblePhrasePattern(value)).join("|");
    const boundaryLabels = Array.from(new Set([
      ...(Array.isArray(stopLabels) ? stopLabels : []),
      ...defaultStopLabels,
    ]));
    const stopPattern = boundaryLabels.length
      ? boundaryLabels.map((value) => buildFlexiblePhrasePattern(value)).join("|")
      : null;
    const match = normalized.match(
      new RegExp(
        `(?:${startPattern})\\s*[:\\-]?\\s*([\\s\\S]{18,}?)(?=\\s*(?:${stopPattern ? `${stopPattern}|$` : "$"}))`,
        "i",
      ),
    );
    const extracted = cleanPdfExtractedValue(match?.[1] || "");
    return extracted || null;
  };

  const oneOnOne = segmentFor(
    ["One-On-One - SX", "One-On-One", "Sexual Instinct", "One-to-One instinct", "One-On-One instinct"],
    ["Social - SO", "Self-Preservation - SP", "Self Preservation - SP"],
  );
  const social = segmentFor(
    ["Social - SO", "Social instinct"],
    ["One-On-One - SX", "One-On-One", "One to One", "Self-Preservation - SP", "Self Preservation - SP"],
  );
  const selfPres = segmentFor(
    ["Self-Preservation - SP", "Self Preservation - SP", "Self-Preservation instinct", "Self Preservation instinct"],
    [],
  );
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
  const instinctOneOnOneInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.instinctGoalOneOnOne,
  );
  const instinctSocialInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.instinctGoalSocial,
  );
  const instinctSelfPresInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.instinctGoalSelfPres,
  );
  const developingAsInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.developingAsCopy,
    { includeStartAnchor: true },
  );
  const developingAsInstructionRows = extractInstructionBulletRowsFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.developingAsCopy,
    10,
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
  const whatYouDoInstructionRows = extractInstructionBulletRowsFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.whatYouDoWhenTriggered,
    10,
  );
  const conflictDevelopmentGoalsInstructionText = extractInstructionTextFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.conflictDevelopmentGoals,
    { includeStartAnchor: true },
  );
  const conflictDevelopmentGoalRows = extractInstructionBulletRowsFromReportContent(
    parsedProfile,
    ASSIGNED_PDF_INSTRUCTION_RULES.conflictDevelopmentGoals,
    12,
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
  const developingAsRowsFromText = splitDevelopmentExercisesTextBlock(
    developingAsInstructionText || "",
  )
    .map((row) => compactInsightSnippet(row?.text || "", 210))
    .filter(Boolean)
    .filter((row) => !isMissingExtractedText(row))
    .filter((row) => !isLikelyGarbledDevelopmentExerciseText(row));
  const developingAsBulletRows = Array.from(
    new Set(
      [
        ...developingAsInstructionRows.map((row) => compactInsightSnippet(row || "", 210)).filter(Boolean),
        ...developingAsRowsFromText,
      ]
        .map((row) => cleanPdfExtractedValue(row))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row))
        .filter((row) => !isLikelyGarbledDevelopmentExerciseText(row)),
    ),
  ).slice(0, 10);
  const developingAsFallbackCopy = extractSpreadsheetSnippetFromText(
    developingAsInstructionText || subtypesText,
    ["Developing as", "Development", "growth edge", "Development Exercise"],
  );
  const developingAsRows = developingAsBulletRows.length
    ? developingAsBulletRows
    : extractNarrativeBulletItems(developingAsFallbackCopy || "", 8);
  const conflictTriggeredBulletRows = Array.from(
    new Set(
      [
        ...conflictDevelopmentGoalRows.map((row) => compactInsightSnippet(row || "", 210)).filter(Boolean),
        ...whatYouDoInstructionRows.map((row) => compactInsightSnippet(row || "", 210)).filter(Boolean),
      ]
        .map((row) => cleanPdfExtractedValue(row))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 12);
  const conflictTriggeredFallbackText =
    conflictDevelopmentGoalsInstructionText || whatYouDoInstructionText || conflictTriggeredInstructionText || conflictText;
  const conflictTriggeredRows = conflictTriggeredBulletRows.length
    ? conflictTriggeredBulletRows
    : extractNarrativeBulletItems(conflictTriggeredFallbackText || "", 12);

  const focused = {
    motivationSummary: extractMotivationalNeedSummary(
      normalizeExtractedText(`${motivationInstructionText || ""} ${coreTypeText || ""}`),
    ) || extractSpreadsheetSnippetFromText(
      motivationInstructionText || coreTypeText,
      ["Motivation", "Key motivations", "motivated"],
    ),
    instinctGoals: null,
    developingAsCopy: developingAsFallbackCopy,
    developingAsBullets: developingAsRows,
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
      conflictTriggeredFallbackText,
      ["Development goals", "What you do when triggered", "when triggered", "triggered", "What triggers you"],
    ),
    conflictTriggeredBullets: conflictTriggeredRows,
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
      2000,
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
  const instinctGoalsFromAnchoredParagraphs = {
    oneOnOne: cleanPdfExtractedValue(instinctOneOnOneInstructionText || "") || null,
    social: cleanPdfExtractedValue(instinctSocialInstructionText || "") || null,
    selfPres: cleanPdfExtractedValue(instinctSelfPresInstructionText || "") || null,
  };
  const instinctGoalsFromDefinitionsBlock = extractInstinctGoalDefinitions(subtypesText);
  const instinctGoalsFromFallback = extractInstinctGoalDefinitions(
    normalizeExtractedText(`${instinctInstructionText || ""} ${subtypesText || ""}`),
  );
  const pickInstinctGoal = (...values) => {
    for (const value of values) {
      const snippet = sanitizeSnippet(value || "", "");
      if (!snippet) continue;
      if (isMissingExtractedText(snippet)) continue;
      return snippet;
    }
    return null;
  };
  focused.instinctGoals = {
    selfPres: pickInstinctGoal(
      instinctGoalsFromAnchoredParagraphs.selfPres,
      instinctGoalsFromDefinitionsBlock?.selfPres,
      instinctGoalsFromFallback?.selfPres,
    ),
    social: pickInstinctGoal(
      instinctGoalsFromAnchoredParagraphs.social,
      instinctGoalsFromDefinitionsBlock?.social,
      instinctGoalsFromFallback?.social,
    ),
    oneOnOne: pickInstinctGoal(
      instinctGoalsFromAnchoredParagraphs.oneOnOne,
      instinctGoalsFromDefinitionsBlock?.oneOnOne,
      instinctGoalsFromFallback?.oneOnOne,
    ),
  };
  if (!focused.instinctGoals.selfPres && !focused.instinctGoals.social && !focused.instinctGoals.oneOnOne) {
    focused.instinctGoals = null;
  }
  console.log("[spreadsheet-focus] extracted structured section focuses", {
    hasMotivation: Boolean(focused.motivationSummary),
    hasInstinctGoals: Boolean(focused.instinctGoals),
    developingAsBullets: Array.isArray(focused.developingAsBullets) ? focused.developingAsBullets.length : 0,
    bodyLanguageRows: focused.bodyLanguageRows.length,
    hasConflictResponse: Boolean(focused.conflictResponseCopy),
    conflictTriggeredBullets: Array.isArray(focused.conflictTriggeredBullets) ? focused.conflictTriggeredBullets.length : 0,
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
  const developingAsCopy = extractSpreadsheetSnippetFromText(normalized, ["Developing as", "Development", "growth edge"]);
  const developingAsBullets = extractNarrativeBulletItems(developingAsCopy || "", 8)
    .map((row) => cleanPdfExtractedValue(row))
    .filter(Boolean)
    .filter((row) => !isMissingExtractedText(row));
  const focused = {
    motivationSummary:
      extractMotivationalNeedSummary(normalized) ||
      extractSpreadsheetSnippetFromText(normalized, ["Motivation", "Key motivations", "motivated"]),
    instinctGoals: extractInstinctGoalDefinitions(normalized),
    developingAsCopy,
    developingAsBullets,
    bodyLanguageRows: extractBodyLanguageRowsFromText(normalized),
    conflictResponseCopy: extractSpreadsheetSnippetFromText(normalized, ["Response to Conflict", "conflict response"]),
    conflictTriggeredCopy: extractSpreadsheetSnippetFromText(normalized, ["What you do when triggered", "when triggered", "triggered"]),
    conflictTriggeredBullets: extractNarrativeBulletItems(
      extractSpreadsheetSnippetFromText(normalized, ["Development goals", "What you do when triggered", "when triggered", "triggered"]),
      12,
    )
      .map((row) => cleanPdfExtractedValue(row))
      .filter(Boolean)
      .filter((row) => !isMissingExtractedText(row)),
    centeredDecisionCopy: extractSpreadsheetSnippetFromText(normalized, ["Centered Decisions", "centered decisions"]),
    decisionImpactCopy: extractSpreadsheetSnippetFromText(normalized, ["Impact of your Ennea style", "Impact of your Enneagram style", "Impact of your style"]),
    decisionStrainCopy: extractSpreadsheetSnippetFromText(normalized, ["Level strain", "decision strain", "Strain"], 2000),
    strategicLeadershipCopy: extractSpreadsheetSnippetFromText(normalized, ["Strategic Leadership", "Visioning", "Alignment", "Change Management"]),
    teamImpactCopy: extractSpreadsheetSnippetFromText(normalized, ["Your Impact on Team", "Impact on Team"]),
    interdependenceCopy: extractSpreadsheetSnippetFromText(normalized, ["Interdependence and Team Role", "Intedependence and Team Role", "Interdependence", "Team Role"]),
    coachingRelationshipCopy: extractSpreadsheetSnippetFromText(normalized, ["Coaching Relationship", "coaching relationship"]),
  };
  console.log("[spreadsheet-focus] extracted PDF-text section focuses", {
    hasMotivation: Boolean(focused.motivationSummary),
    hasInstinctGoals: Boolean(focused.instinctGoals),
    developingAsBullets: focused.developingAsBullets.length,
    bodyLanguageRows: focused.bodyLanguageRows.length,
    hasConflictResponse: Boolean(focused.conflictResponseCopy),
    conflictTriggeredBullets: focused.conflictTriggeredBullets.length,
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
  const pickHydratedSnippet = (values) => {
    const candidates = Array.isArray(values) ? values : [];
    for (const value of candidates) {
      const normalized = sanitizeSnippet(value || "", "");
      if (!normalized) continue;
      if (isMissingExtractedText(normalized)) continue;
      return normalized;
    }
    for (const value of candidates) {
      const normalized = sanitizeSnippet(value || "", "");
      if (normalized) return normalized;
    }
    return fallback;
  };
  const mergeGoal = (key) => pickHydratedSnippet([structured?.instinctGoals?.[key], pdf?.instinctGoals?.[key]]);
  const bulletRowsFromSnippet = (snippet, maxItems = 10) => {
    const normalized = sanitizeSnippet(snippet || "", "");
    if (!normalized || isMissingExtractedText(normalized)) return [];
    const symbolSplit = normalized
      .split(/\s*[•·▪◦*]\s+/)
      .map((row) => cleanPdfExtractedValue(row))
      .filter(Boolean);
    const rows = symbolSplit.length > 1
      ? symbolSplit
      : normalized
          .split(/(?<=[.?!])\s+/)
          .map((row) => cleanPdfExtractedValue(row))
          .filter(Boolean);
    return rows
      .map((row) => row.replace(/^\s*[-–—.,;:!?]+\s*(?=[A-Za-z])/, ""))
      .map((row) => row.replace(/^\s*([a-z])/, (_, char) => char.toUpperCase()))
      .filter(Boolean)
      .slice(0, maxItems);
  };
  const mergedDevelopingAsBullets = Array.from(
    new Set(
      [
        ...(Array.isArray(structured.developingAsBullets) ? structured.developingAsBullets : []),
        ...(Array.isArray(pdf.developingAsBullets) ? pdf.developingAsBullets : []),
        ...bulletRowsFromSnippet(structured.developingAsCopy),
        ...bulletRowsFromSnippet(pdf.developingAsCopy),
      ]
        .map((row) => cleanPdfExtractedValue(row || ""))
        .map((row) => row.replace(/^\s*[-–—.,;:!?]+\s*(?=[A-Za-z])/, ""))
        .map((row) => row.replace(/^\s*([a-z])/, (_, char) => char.toUpperCase()))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 12);
  const mergedConflictTriggeredBullets = Array.from(
    new Set(
      [
        ...(Array.isArray(structured.conflictTriggeredBullets) ? structured.conflictTriggeredBullets : []),
        ...(Array.isArray(pdf.conflictTriggeredBullets) ? pdf.conflictTriggeredBullets : []),
        ...bulletRowsFromSnippet(structured.conflictTriggeredCopy, 12),
        ...bulletRowsFromSnippet(pdf.conflictTriggeredCopy, 12),
      ]
        .map((row) => cleanPdfExtractedValue(row || ""))
        .map((row) => row.replace(/^\s*[-–—.,;:!?]+\s*(?=[A-Za-z])/, ""))
        .map((row) => row.replace(/^\s*([a-z])/, (_, char) => char.toUpperCase()))
        .filter(Boolean)
        .filter((row) => !isMissingExtractedText(row)),
    ),
  ).slice(0, 16);
  const mergedBodyRows = [...(Array.isArray(structured.bodyLanguageRows) ? structured.bodyLanguageRows : []), ...(Array.isArray(pdf.bodyLanguageRows) ? pdf.bodyLanguageRows : [])]
    .map((row) => cleanPdfExtractedValue(row || ""))
    .filter(Boolean)
    .filter((row) => !isMissingExtractedText(row))
    .slice(0, 6);
  return {
    motivationSummary: pickHydratedSnippet([structured.motivationSummary, pdf.motivationSummary]),
    instinctGoals: {
      selfPres: mergeGoal("selfPres"),
      social: mergeGoal("social"),
      oneOnOne: mergeGoal("oneOnOne"),
    },
    developingAsCopy: pickHydratedSnippet([structured.developingAsCopy, pdf.developingAsCopy, mergedDevelopingAsBullets[0]]),
    developingAsBullets: mergedDevelopingAsBullets,
    bodyLanguageRows: mergedBodyRows.length ? mergedBodyRows : [fallback],
    conflictResponseCopy: pickHydratedSnippet([structured.conflictResponseCopy, pdf.conflictResponseCopy]),
    conflictTriggeredCopy: pickHydratedSnippet([structured.conflictTriggeredCopy, pdf.conflictTriggeredCopy, mergedConflictTriggeredBullets[0]]),
    conflictTriggeredBullets: mergedConflictTriggeredBullets,
    centeredDecisionCopy: pickHydratedSnippet([structured.centeredDecisionCopy, pdf.centeredDecisionCopy]),
    decisionImpactCopy: pickHydratedSnippet([structured.decisionImpactCopy, pdf.decisionImpactCopy]),
    decisionStrainCopy: pickHydratedSnippet([structured.decisionStrainCopy, pdf.decisionStrainCopy]),
    strategicLeadershipCopy: pickHydratedSnippet([structured.strategicLeadershipCopy, pdf.strategicLeadershipCopy]),
    teamImpactCopy: pickHydratedSnippet([structured.teamImpactCopy, pdf.teamImpactCopy]),
    interdependenceCopy: pickHydratedSnippet([structured.interdependenceCopy, pdf.interdependenceCopy]),
    coachingRelationshipCopy: pickHydratedSnippet([structured.coachingRelationshipCopy, pdf.coachingRelationshipCopy]),
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
  const parserVerification =
    parseDiagnostics?.verification && typeof parseDiagnostics.verification === "object"
      ? parseDiagnostics.verification
      : null;
  const pythonChecks =
    parserVerification?.checks && typeof parserVerification.checks === "object"
      ? parserVerification.checks
      : {};
  const pythonCheckKeys = Object.keys(pythonChecks).filter((key) => key !== "pageCoverage");
  const pythonChecksTotal = pythonCheckKeys.length;
  const pythonChecksMatched = pythonCheckKeys.filter(
    (key) => String(pythonChecks?.[key]?.status || "") === "match",
  ).length;
  const pythonMismatches = Number.isFinite(Number(parserVerification?.mismatchCount))
    ? Number(parserVerification.mismatchCount)
    : pythonCheckKeys.filter((key) => String(pythonChecks?.[key]?.status || "") === "mismatch").length;
  const pythonVerificationSummary = !parserVerification
    ? "not provided"
    : parserVerification?.available
      ? `${pythonChecksMatched}/${pythonChecksTotal || 0} checks matched`
      : `unavailable (${String(parserVerification?.reason || "unknown")})`;
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
  if (parserVerification && !parserVerification.available) {
    issues.push(`Python verification unavailable: ${String(parserVerification.reason || "unknown")}.`);
  }
  if (pythonMismatches > 0) {
    const mismatchFields = Array.isArray(parserVerification?.mismatchKeys) && parserVerification.mismatchKeys.length
      ? parserVerification.mismatchKeys.join(", ")
      : "unknown fields";
    issues.push(`Python cross-check mismatches detected (${pythonMismatches}): ${mismatchFields}.`);
  }

  const summary = [
    `Parser status: ${parseDiagnostics?.isComplete ? "complete" : "incomplete"}`,
    `Extracted pages: ${pages}`,
    `Detected pages: ${detectedTotalPages > 0 ? detectedTotalPages : "not available"}`,
    `Expected minimum pages: ${minExpectedPages > 0 ? minExpectedPages : "not set"}`,
    `Sections: ${sections}`,
    `Type scores populated: ${typeScoresPopulated}/${typeScoresTotal}`,
    `Python verification: ${pythonVerificationSummary}`,
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
      pythonChecksMatched,
      pythonChecksTotal,
      pythonMismatches,
      pythonVerificationAvailable: Boolean(parserVerification?.available),
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
      ...(REPORT_EXAMPLES[normalizedTypeId] || REPORT_EXAMPLES[DEFAULT_EXAMPLE_REPORT_TYPE]),
    });
    lastAppliedExampleType = String(REPORT.typeNumber || DEFAULT_EXAMPLE_REPORT_TYPE);
    reflectionDeck = buildReflectionDeck(REPORT);
    console.log('[report-switch] applying', REPORT.typeNumber, REPORT.typeName);
    renderReportFromState(true);
  } catch (error) {
    console.log('[report-switch] failed', error);
  }
}

function buildPdfOnlyProfile(typeNumber, extractedScores) {
  const order = ["8", "9", "1", "2", "3", "4", "5", "6", "7"];
  const normalized = order.map((type) => {
    const value = toFiniteScoreOrNull(extractedScores?.[type]);
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    return value;
  });
  if (normalized.some((value) => Number.isFinite(value))) {
    return normalized;
  }
  return order.map(() => null);
}

function buildPdfOnlyReport(payload) {
  const fallbackText = "Not detected in assigned PDF.";
  const typeNumber = String(payload?.typeNumber || "").match(/^[1-9]$/)?.[0] || "?";
  const typeName = sanitizeSnippet(payload?.typeName, fallbackText);
  const instinct = sanitizeSnippet(payload?.instinct, fallbackText);
  const keyword = sanitizeSnippet(payload?.subtypeKeyword, fallbackText);
  const release = formatTypeLine(sanitizeSnippet(payload?.connectedLineA, "Not detected"));
  const stretch = formatTypeLine(sanitizeSnippet(payload?.connectedLineB, "Not detected"));
  const supportsIntegrationLevel = payload?.supportsIntegrationLevel !== false;
  const integration = supportsIntegrationLevel
    ? sanitizeSnippet(payload?.integrationLevel || payload?.integration, fallbackText)
    : null;
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
  const corePatternBullets = normalizeCorePatternBullets(
    Array.isArray(payload?.corePatternBullets) && payload.corePatternBullets.length
      ? payload.corePatternBullets
      : [
          { key: "action", label: "Typical Action Patterns", text: parsedCorePatternLines[0] || null },
          { key: "thinking", label: "Typical Thinking Patterns", text: parsedCorePatternLines[1] || null },
          { key: "feeling", label: "Typical Feeling Patterns", text: parsedCorePatternLines[2] || null },
        ],
  );
  const deepLines = (corePatternBullets
    .map((row) => sanitizeSnippet(row?.text, null))
    .filter(Boolean)
    .filter((line) => !isMissingExtractedText(line)).length
    ? corePatternBullets
        .map((row) => sanitizeSnippet(row?.text, null))
        .filter(Boolean)
        .filter((line) => !isMissingExtractedText(line))
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
    reportType: sanitizeSnippet(payload?.reportType, null),
    supportsIntegrationLevel,
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
    corePatternBullets,
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
          developingAsBullets: Array.isArray(payload.spreadsheetFocuses.developingAsBullets)
            ? payload.spreadsheetFocuses.developingAsBullets
                .map((row) => sanitizeSnippet(row, null))
                .filter(Boolean)
            : [],
          bodyLanguageRows: Array.isArray(payload.spreadsheetFocuses.bodyLanguageRows)
            ? payload.spreadsheetFocuses.bodyLanguageRows
                .map((row) => sanitizeSnippet(row, null))
                .filter(Boolean)
            : [],
          conflictResponseCopy: sanitizeSnippet(payload.spreadsheetFocuses.conflictResponseCopy, "Not detected in assigned PDF."),
          conflictTriggeredCopy: sanitizeSnippet(payload.spreadsheetFocuses.conflictTriggeredCopy, "Not detected in assigned PDF."),
          conflictTriggeredBullets: Array.isArray(payload.spreadsheetFocuses.conflictTriggeredBullets)
            ? payload.spreadsheetFocuses.conflictTriggeredBullets
                .map((row) => sanitizeSnippet(row, null))
                .filter(Boolean)
            : [],
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
    hydrationSourceAudit:
      payload?.hydrationSourceAudit && typeof payload.hydrationSourceAudit === "object"
        ? payload.hydrationSourceAudit
        : {},
    profile,
    strain,
    mainValue: mainIndex >= 0 ? toFiniteScoreOrNull(profile[mainIndex]) : null,
    releaseValue: releaseIndex >= 0 ? toFiniteScoreOrNull(profile[releaseIndex]) : null,
    stretchValue: stretchIndex >= 0 ? toFiniteScoreOrNull(profile[stretchIndex]) : null,
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

function buildGrowthKeyChallenges(report) {
  const typeNumber = String(report?.typeNumber || "?");
  const typeLabel = `Type ${typeNumber}`;
  const keyword = formatOptionalText(report?.keyword, "core pattern");
  const vice = formatOptionalText(report?.vice, "reactive habit");
  const conflictStyle = formatOptionalText(report?.conflictStyle, "adaptive");
  const release = formatTypeLine(report?.release || "Type ?");
  const stretch = formatTypeLine(report?.stretch || "Type ?");
  const supportsIntegrationLevel = report?.supportsIntegrationLevel !== false;
  const integrationLevel = supportsIntegrationLevel
    ? normalizeIntegrationLevel(report?.integration)
    : "steady";

  return [
    {
      title: "Pause Before Force",
      text: `${typeLabel} benefits from slowing the first reaction so urgency does not overrun context.`,
    },
    {
      title: "Name Impact Clearly",
      text: `Under ${String(conflictStyle).toLowerCase()} conflict pressure, name impact before intent to reduce escalation.`,
    },
    {
      title: `Regulate ${vice}`,
      text: `Watch how ${String(vice).toLowerCase()} shows up in tone, speed, and control needs when stakes rise.`,
    },
    {
      title: "Share Ownership",
      text: `Translate ${String(keyword).toLowerCase()} into explicit shared ownership so collaboration scales with execution.`,
    },
    {
      title: `Practice ${stretch} Range`,
      text: `Build stretch-point capacity through one weekly behavior that increases flexibility, empathy, or perspective.`,
    },
    {
      title: `Recover Through ${release}`,
      text: `Use release-point resets to sustain ${String(integrationLevel).toLowerCase()} integration habits and reduce reactivity loops.`,
    },
  ];
}

function renderGrowthKeyChallenges({ report, isExampleMode }) {
  const growthKeyChallengesBox = document.getElementById("growthKeyChallengesBox");
  if (growthKeyChallengesBox) {
    growthKeyChallengesBox.style.display = isExampleMode ? "block" : "none";
    growthKeyChallengesBox.dataset.mode = isExampleMode ? "example" : "assigned-or-client";
  }

  const growthKeyChallengesRows = buildGrowthKeyChallenges(report || {});
  setHtml(
    "growthKeyChallengesList",
    growthKeyChallengesRows
      .map(
        (item) =>
          `<div class="dev-item"><div class="dev-item-title">${escapeHtml(item?.title || "Key Challenge")}</div><p>${escapeHtml(
            formatOptionalText(item?.text, "Not detected in assigned PDF."),
          )}</p></div>`,
      )
      .join(""),
  );

  console.log("[growth] rendered key challenges", {
    mode: isExampleMode ? "example" : "assigned-or-client",
    typeNumber: String(report?.typeNumber || ""),
    count: growthKeyChallengesRows.length,
  });
}

function setIntegrationUiVisibility(isVisible) {
  const shouldShow = Boolean(isVisible);
  const rowNode = document.getElementById("integrationValueRow");
  if (rowNode) rowNode.style.display = shouldShow ? "" : "none";

  const integrationSectionNode = document.getElementById("sec-integration");
  if (integrationSectionNode) integrationSectionNode.style.display = shouldShow ? "" : "none";

  const integrationButtons = document.querySelectorAll('.nav button[data-sec="integration"],.mobile-menu-item[data-sec="integration"]');
  integrationButtons.forEach((button) => {
    button.style.display = shouldShow ? "" : "none";
    if (!shouldShow) {
      button.classList.remove("active");
    }
  });

  if (!shouldShow && integrationSectionNode?.classList.contains("active")) {
    showSec("overview");
  }
}

function renderReportFromState(isExampleMode) {
  const missingAssignedPdfText = "Not detected in assigned PDF.";
  renderGrowthKeyChallenges({ report: REPORT, isExampleMode });
  setText('typeBadge', REPORT.typeNumber);
  setText('headerSubtitle', `Type ${REPORT.typeNumber} · ${REPORT.instinct}`);
  setText('reportTitle', isExampleMode ? `Type ${REPORT.typeNumber} Example Report` : `Type ${REPORT.typeNumber} Assigned PDF Report`);
  setText('mainTypeValue', currentCoreTypeLabel());
  setText('instinctValue', REPORT.instinct);
  const growthCopy = buildGrowthCopyForDisplay(REPORT);
  setText('growthStretchTitle', growthCopy.stretchTitle);
  setText('growthStretchBody', growthCopy.stretchBody);
  setText('growthStretchFollowup', growthCopy.stretchFollowup);
  setText('growthStretchQuote', growthCopy.stretchQuote);
  setText('growthReleaseTitle', growthCopy.releaseTitle);
  setText('growthReleaseBody', growthCopy.releaseBody);
  setText('growthReleaseIbox', growthCopy.releaseIbox);
  setText('profileWheelBadgeType', REPORT.typeNumber);
  setText('profileWheelBadgeInstinct', String(REPORT.instinct || '').split('—')[0].trim() || 'N/A');
  // Render the wheel early so assigned/client reports still show the graphic even if later blocks throw.
  try {
    renderProfileWheel();
  } catch (error) {
    console.log('[profile-wheel] early render failed', error);
  }
  setText('releaseValue', formatTypeLine(REPORT.release));
  setText('stretchValue', formatTypeLine(REPORT.stretch));
  const supportsIntegrationLevel = REPORT?.supportsIntegrationLevel !== false;
  setIntegrationUiVisibility(supportsIntegrationLevel);
  if (supportsIntegrationLevel) {
    const normalizedIntegrationLevel = normalizeIntegrationLevel(REPORT.integration);
    setText('integrationValue', normalizedIntegrationLevel);
    renderIntegrationPanel(normalizedIntegrationLevel);
    renderWingInfluencePanel(REPORT, normalizedIntegrationLevel);
  } else {
    setText('integrationValue', "Not available for STD report.");
  }
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
  const pythonMismatches = Number.isFinite(Number(diagnosticsSnapshot?.pythonMismatches))
    ? Number(diagnosticsSnapshot.pythonMismatches)
    : 0;
  setText(
    'extractedVerificationValue',
    `Detected pages: ${detectedPages > 0 ? detectedPages : "Not available"} · Type scores populated: ${typeScoresPopulated}/${typeScoresTotal} · Python mismatches: ${pythonMismatches}`,
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
    renderDevelopmentExerciseGridItems(exercises),
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

  const corePatternBulletsForRender = resolveCorePatternBulletsForRender(REPORT);
  const centerScores = REPORT.centerScoresRaw || {};
  renderCenterExpressionWheel(centerScores);
  sortCenterExpressionRows(centerScores);

  const centerPatternItemsByKey = {};
  CENTER_PATTERN_COLUMNS.forEach((column) => {
    const items = resolveCenterPatternItems(corePatternBulletsForRender, column.patternKey, 3);
    centerPatternItemsByKey[column.patternKey] = items;
    setHtml(column.listId, renderCenterPatternRows(items, column));
  });
  CENTER_NARRATIVE_SLOTS.forEach((slot) => {
    const items = centerPatternItemsByKey[slot.patternKey] || [];
    const narrative = ensureSentenceStartsCapitalized(
      formatOptionalText(items[0], "Not detected in assigned PDF."),
    );
    setHtml(slot.id, `<strong>${escapeHtml(slot.label)}:</strong> ${escapeHtml(narrative)}`);
  });

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
  setHtml(
    'deepTitle',
    `<span class="title-icon-chip"><span class="title-icon">${iconSvg('users', 12, 'var(--blue)')}</span></span>${escapeHtml(
      ensureSentenceStartsCapitalized(formatOptionalText(REPORT.deepTitle, "Not detected in assigned PDF.")),
    )}`,
  );
  setHtml('corePatternBulletsList', renderCorePatternBulletList(corePatternBulletsForRender));
  const deepSummaryCard = document.getElementById('deepSummaryCard');
  if (deepSummaryCard) {
    const isAssignedPdfSummary = /assigned\s+pdf\s+summary/i.test(String(REPORT.deepTitle || ""));
    deepSummaryCard.style.display = isAssignedPdfSummary ? "none" : "block";
  }
  document.getElementById('languageTitle').innerHTML = `<span class="title-icon-chip"><span class="title-icon">${iconSvg('communication', 12, 'var(--blue)')}</span></span>Type ${REPORT.typeNumber} Communication Style`;
  setText('languageMeta', REPORT.meta);
  setText('refTypeTag', `Type ${REPORT.typeNumber} · ${String(REPORT.instinct || "").split(' — ')[0]}`);
  const adaptiveCopy = renderAdaptiveSectionCopy(REPORT);
  const spreadsheetFocusFallbacks = isExampleMode ? buildSpreadsheetFocusFallbacks(REPORT, adaptiveCopy) : {};
  const spreadsheetFocusesFromReport = REPORT.spreadsheetFocuses && typeof REPORT.spreadsheetFocuses === "object"
    ? REPORT.spreadsheetFocuses
    : {};
  const resolveSpreadsheetFocusText = (primaryText, fallbackText = missingAssignedPdfText) => {
    const primary = formatOptionalText(primaryText, "");
    if (primary && !isMissingExtractedText(primary)) return primary;
    const fallback = formatOptionalText(fallbackText, "");
    if (fallback && !isMissingExtractedText(fallback)) return fallback;
    return missingAssignedPdfText;
  };
  setText(
    'motivationSummary',
    resolveSpreadsheetFocusText(
      spreadsheetFocusesFromReport.motivationSummary,
      spreadsheetFocusFallbacks.motivationSummary,
    ),
  );
  setText(
    'instinctGoalSelfPres',
    resolveSpreadsheetFocusText(
      spreadsheetFocusesFromReport?.instinctGoals?.selfPres,
      spreadsheetFocusFallbacks?.instinctGoals?.selfPres,
    ),
  );
  setText(
    'instinctGoalSocial',
    resolveSpreadsheetFocusText(
      spreadsheetFocusesFromReport?.instinctGoals?.social,
      spreadsheetFocusFallbacks?.instinctGoals?.social,
    ),
  );
  setText(
    'instinctGoalOneOnOne',
    resolveSpreadsheetFocusText(
      spreadsheetFocusesFromReport?.instinctGoals?.oneOnOne,
      spreadsheetFocusFallbacks?.instinctGoals?.oneOnOne,
    ),
  );
  renderDominantInstinctGoalBorder(REPORT.instinct);
  setHtml(
    'conflictResponseCopy',
    renderNarrativeBullets(
      resolveSpreadsheetFocusText(
        spreadsheetFocusesFromReport.conflictResponseCopy,
        spreadsheetFocusFallbacks.conflictResponseCopy,
      ),
      { maxItems: 8 },
    ),
  );
  const conflictTriggeredRows = (Array.isArray(spreadsheetFocusesFromReport.conflictTriggeredBullets)
    ? spreadsheetFocusesFromReport.conflictTriggeredBullets
    : [])
    .map((row) => cleanPdfExtractedValue(formatOptionalText(row, "")))
    .filter(Boolean)
    .filter((row) => !isMissingExtractedText(row));
  const conflictTriggeredFallbackRows = extractNarrativeBulletItems(
    resolveSpreadsheetFocusText(
      spreadsheetFocusesFromReport.conflictTriggeredCopy,
      spreadsheetFocusFallbacks.conflictTriggeredCopy,
    ),
    16,
  )
    .map((row) => cleanPdfExtractedValue(row))
    .filter(Boolean)
    .filter((row) => !isMissingExtractedText(row));
  const conflictTriggeredItems = conflictTriggeredRows.length
    ? conflictTriggeredRows
    : (conflictTriggeredFallbackRows.length ? conflictTriggeredFallbackRows : [missingAssignedPdfText]);
  setHtml(
    'conflictTriggeredCopy',
    buildAdaptiveListHtml(
      conflictTriggeredItems.map((text) => ({
        tone: "neu",
        symbol: "•",
        text,
      })),
    ),
  );
  setHtml(
    'centeredDecisionCopy',
    renderNarrativeBullets(
      resolveSpreadsheetFocusText(
        spreadsheetFocusesFromReport.centeredDecisionCopy,
        spreadsheetFocusFallbacks.centeredDecisionCopy,
      ),
      { maxItems: 8 },
    ),
  );
  setHtml(
    'decisionImpactCopy',
    renderNarrativeBullets(
      resolveSpreadsheetFocusText(
        spreadsheetFocusesFromReport.decisionImpactCopy,
        spreadsheetFocusFallbacks.decisionImpactCopy,
      ),
      { maxItems: 10 },
    ),
  );
  setHtml(
    'decisionStrainCopy',
    renderNarrativeBullets(
      resolveSpreadsheetFocusText(
        spreadsheetFocusesFromReport.decisionStrainCopy,
        spreadsheetFocusFallbacks.decisionStrainCopy,
      ),
      { maxItems: 8 },
    ),
  );
  setHtml(
    'strategicLeadershipCopy',
    renderNarrativeBullets(
      resolveSpreadsheetFocusText(
        spreadsheetFocusesFromReport.strategicLeadershipCopy,
        spreadsheetFocusFallbacks.strategicLeadershipCopy,
      ),
      { maxItems: 10 },
    ),
  );
  setHtml(
    'teamImpactCopy',
    renderNarrativeBullets(
      resolveSpreadsheetFocusText(
        spreadsheetFocusesFromReport.teamImpactCopy,
        spreadsheetFocusFallbacks.teamImpactCopy,
      ),
      { maxItems: 10 },
    ),
  );
  setHtml(
    'interdependenceCopy',
    renderNarrativeBullets(
      resolveSpreadsheetFocusText(
        spreadsheetFocusesFromReport.interdependenceCopy,
        spreadsheetFocusFallbacks.interdependenceCopy,
      ),
      { maxItems: 6 },
    ),
  );
  setHtml(
    'coachingRelationshipCopy',
    renderNarrativeBullets(
      resolveSpreadsheetFocusText(
        spreadsheetFocusesFromReport.coachingRelationshipCopy,
        spreadsheetFocusFallbacks.coachingRelationshipCopy,
      ),
      { maxItems: 10 },
    ),
  );
  const bodyLanguageRows = Array.isArray(spreadsheetFocusesFromReport.bodyLanguageRows)
    ? spreadsheetFocusesFromReport.bodyLanguageRows.filter(Boolean)
    : [];
  const fallbackBodyLanguageRows = Array.isArray(spreadsheetFocusFallbacks.bodyLanguageRows)
    ? spreadsheetFocusFallbacks.bodyLanguageRows.filter(Boolean)
    : [];
  const resolvedBodyLanguageRows = bodyLanguageRows.length
    ? bodyLanguageRows
    : (fallbackBodyLanguageRows.length ? fallbackBodyLanguageRows : [missingAssignedPdfText]);
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
  const teamStageFallbacks = isExampleMode ? (adaptiveCopy?.teamStages || {}) : {};
  const resolveTeamStageText = (value) => {
    const normalized = formatOptionalText(value, "");
    if (normalized && !isMissingExtractedText(normalized)) return normalized;
    return missingAssignedPdfText;
  };
  setHtml(
    'teamStageForming',
    renderTeamStageBullets(
      resolveTeamStageText(
        firstPresentSnippet([teamStagesFromReport.forming, teamStageFallbacks.forming], missingAssignedPdfText),
      ),
    ),
  );
  setHtml(
    'teamStageStorming',
    renderTeamStageBullets(
      resolveTeamStageText(
        firstPresentSnippet([teamStagesFromReport.storming, teamStageFallbacks.storming], missingAssignedPdfText),
      ),
    ),
  );
  setHtml(
    'teamStageNorming',
    renderTeamStageBullets(
      resolveTeamStageText(
        firstPresentSnippet([teamStagesFromReport.norming, teamStageFallbacks.norming], missingAssignedPdfText),
      ),
    ),
  );
  setHtml(
    'teamStagePerforming',
    renderTeamStageBullets(
      resolveTeamStageText(
        firstPresentSnippet([teamStagesFromReport.performing, teamStageFallbacks.performing], missingAssignedPdfText),
      ),
    ),
  );
  console.log('[team-stage] rendered stage breakdown', {
    source: Object.keys(teamStagesFromReport).length
      ? "report-content"
      : (Object.keys(teamStageFallbacks).length ? "example-fallback" : "not-detected"),
    forming: Boolean(teamStagesFromReport.forming),
    storming: Boolean(teamStagesFromReport.storming),
    norming: Boolean(teamStagesFromReport.norming),
    performing: Boolean(teamStagesFromReport.performing),
  });

  const traitChips = document.getElementById('traitChips');
  if (traitChips) {
    const resolvedTraitChips = resolveReportTraitChips(REPORT, REPORT_EXAMPLES, { maxItems: 5 });
    traitChips.innerHTML = resolvedTraitChips
      .map((trait) => `<span class="chip cgn">${escapeHtml(trait)}</span>`)
      .join('');
  }

  if (!isExampleMode) {
    applyAssignedHydrationContractDiagnostics(REPORT);
  }

  updateCharts();
  buildReportModuleIndex();
  genReflection();
}

function applyAssignedPdfReport(payload) {
  try {
    REPORT = buildPdfOnlyReport(payload);
    latestAssignedPdfReport = REPORT;
    const isClientReportView = currentReportViewMode === "client-report";
    currentReportViewMode = isClientReportView ? "client-report" : "assigned-report";
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
    if (currentReportViewMode !== "example") return;
    const reportSelector = getReportSelector();
    if (!reportSelector) return;
    const selectedType = String(reportSelector.value || "").trim();
    if (!/^[1-9]$/.test(selectedType)) return;
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
  console.log('[report-switch] selector changed to', selectedType);
  if (!/^[1-9]$/.test(selectedType)) {
    const fallbackType = String(lastAppliedExampleType || DEFAULT_EXAMPLE_REPORT_TYPE);
    if (event?.target) event.target.value = fallbackType;
    console.log("[report-switch] ignored invalid example type selection", {
      selectedType,
      fallbackType,
      currentReportViewMode,
    });
    return;
  }
  invalidateAssignedReportIngestion("manual-example-selector-change");
  currentClientReportId = null;
  resetClientReportSelectorSelection();
  currentReportViewMode = "example";
  latestAssignedPdfReport = null;
  applyReport(selectedType);
}

function onClientReportSelectorChange(event) {
  const selectedReportId = String(event?.target?.value || getClientReportSelector()?.value || "").trim();
  if (!selectedReportId) {
    invalidateAssignedReportIngestion("client-report-selection-cleared");
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
  setHtml('refCard', `<p class="sb-tip">${escapeHtml(ensureSentenceStartsCapitalized(choice))}</p>`);
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
