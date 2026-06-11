import { NextResponse } from "next/server";
import { parsePdf } from "../../../../lib/parsePdf.js";
import { resolvePdfSanitizeFormFieldMode, sanitizePdfForParsing } from "../../../../lib/pdfSanitize.js";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const DEFAULT_ROUTE_IMAGE_PAGE_LIMIT = 24;
const ADMIN_INLINE_SAFE_MODE = "admin-inline-safe";

function mergeSanitizationIntoParsedPayload(parsed, sanitizationDiagnostics) {
  if (!parsed || typeof parsed !== "object") return parsed;
  return {
    ...parsed,
    _parseDiagnostics: {
      ...(parsed?._parseDiagnostics && typeof parsed._parseDiagnostics === "object"
        ? parsed._parseDiagnostics
        : {}),
      sanitization: sanitizationDiagnostics || null,
    },
    parseSanitization: sanitizationDiagnostics || null,
  };
}

function isPdfFile(file) {
  return file instanceof File && file.type === "application/pdf";
}

function toPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

function toNonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

function toNonNegativeNumber(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Number(numeric.toFixed(precision));
}

function normalizeNoiseSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "unknown" ||
    normalized === "minimal" ||
    normalized === "low" ||
    normalized === "moderate" ||
    normalized === "high"
  ) {
    return normalized;
  }
  return null;
}

function deriveNoiseSeverity(controlNoisePer10kChars) {
  if (!Number.isFinite(Number(controlNoisePer10kChars)) || Number(controlNoisePer10kChars) < 0) {
    return "unknown";
  }
  const density = Number(controlNoisePer10kChars);
  if (density < 1) return "minimal";
  if (density < 5) return "low";
  if (density < 20) return "moderate";
  return "high";
}

function buildParseNoiseContract(parsed) {
  const noiseSource =
    parsed?.parseNoise && typeof parsed.parseNoise === "object"
      ? parsed.parseNoise
      : parsed?._parseDiagnostics?.noise && typeof parsed._parseDiagnostics.noise === "object"
        ? parsed._parseDiagnostics.noise
        : parsed?._parseDiagnostics?.verification?.noise &&
            typeof parsed._parseDiagnostics.verification.noise === "object"
          ? parsed._parseDiagnostics.verification.noise
          : parsed?._parseDiagnostics?.verification?.python?.textNoise &&
              typeof parsed._parseDiagnostics.verification.python.textNoise === "object"
            ? parsed._parseDiagnostics.verification.python.textNoise
            : null;
  if (!noiseSource) return null;

  const score = toNonNegativeInteger(noiseSource?.score);
  const controlNoisePer10kChars = toNonNegativeNumber(noiseSource?.controlNoisePer10kChars, 2);
  const severity = normalizeNoiseSeverity(noiseSource?.severity) || deriveNoiseSeverity(controlNoisePer10kChars);
  const controlNoiseChars = toNonNegativeInteger(noiseSource?.controlNoiseChars);
  const replacementChars = toNonNegativeInteger(noiseSource?.replacementChars);
  const totalNoiseChars =
    toNonNegativeInteger(noiseSource?.totalNoiseChars) ??
    toNonNegativeInteger((controlNoiseChars || 0) + (replacementChars || 0));
  const totalChars = toNonNegativeInteger(noiseSource?.totalChars);
  const pagesWithControlNoise = toNonNegativeInteger(noiseSource?.pagesWithControlNoise);
  const pageCount = toNonNegativeInteger(noiseSource?.pageCount);

  return {
    score: score == null && controlNoisePer10kChars != null ? Math.round(controlNoisePer10kChars) : score,
    severity,
    controlNoiseChars: controlNoiseChars ?? 0,
    replacementChars: replacementChars ?? 0,
    totalNoiseChars: totalNoiseChars ?? 0,
    totalChars: totalChars ?? 0,
    controlNoisePer10kChars: controlNoisePer10kChars ?? 0,
    pagesWithControlNoise: pagesWithControlNoise ?? 0,
    pageCount: pageCount ?? 0,
  };
}

function buildParseContract(parsed) {
  const parsedPages = toPositiveInteger(
    parsed?.parseCoverage?.parsedPages ??
      parsed?._parseDiagnostics?.extraction?.pages ??
      parsed?.reportContent?.pages?.length ??
      null,
  );
  const detectedTotalPages = toPositiveInteger(
    parsed?.parseCoverage?.detectedTotalPages ??
      parsed?._parseDiagnostics?.extraction?.detectedTotalPages ??
      null,
  );
  const minExpectedPages = toPositiveInteger(
    parsed?.parseCoverage?.minExpectedPages ??
      parsed?._parseDiagnostics?.extraction?.minExpectedPages ??
      null,
  );
  const coverageTarget = detectedTotalPages || minExpectedPages || null;
  const parseCoverage = {
    parsedPages,
    detectedTotalPages,
    minExpectedPages,
    isCoverageComplete: coverageTarget != null
      ? (parsedPages != null && parsedPages >= coverageTarget)
      : Boolean(parsedPages != null && parsedPages > 0),
  };

  const verificationSummary = {
    available: Boolean(
      parsed?.verificationSummary?.available ?? parsed?._parseDiagnostics?.verification?.available,
    ),
    mismatchCount: Number(parsed?.verificationSummary?.mismatchCount ?? parsed?._parseDiagnostics?.verification?.mismatchCount ?? 0),
    criticalMismatchCount: Number(
      parsed?.verificationSummary?.criticalMismatchCount ??
        parsed?._parseDiagnostics?.verification?.criticalMismatchCount ??
        0,
    ),
    criticalMismatchKeys: Array.isArray(
      parsed?.verificationSummary?.criticalMismatchKeys ??
        parsed?._parseDiagnostics?.verification?.criticalMismatchKeys,
    )
      ? (parsed?.verificationSummary?.criticalMismatchKeys ??
          parsed?._parseDiagnostics?.verification?.criticalMismatchKeys)
          .filter(Boolean)
      : [],
  };

  const parseState = String(
    parsed?.parseState ??
      parsed?._parseState ??
      parsed?._parseStatus ??
      "unknown",
  ).toLowerCase();
  const parseReason = String(
    parsed?.parseReason ??
      parsed?._parseReason ??
      parsed?._parseDiagnostics?.parseReason ??
      parsed?._parseDiagnostics?.incompleteReason ??
      "",
  ).trim() || null;
  const parseNoise = buildParseNoiseContract(parsed);

  return { parseCoverage, verificationSummary, parseNoise, parseState, parseReason };
}

export async function POST(req) {
  try {
    const formData = await req.formData();
    const report = formData.get("report");
    const clientId = String(formData.get("clientId") || "").trim() || null;
    const mode = String(formData.get("mode") || "").trim().toLowerCase();

    if (!(report instanceof File)) {
      return NextResponse.json(
        { error: "No PDF uploaded. Use multipart field name: report" },
        { status: 400 },
      );
    }

    if (!isPdfFile(report)) {
      return NextResponse.json(
        { error: "Only PDF files are accepted" },
        { status: 400 },
      );
    }

    const sizeBytes = Number(report.size || 0);
    if (sizeBytes > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "PDF exceeds maximum size of 25 MB" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await report.arrayBuffer());
    const routeImagePageLimitRaw = Number(
      process.env.PDF_PARSE_ROUTE_IMAGE_FULL_DOC_MAX_PAGES ??
        process.env.PDF_PARSE_IMAGE_FULL_DOC_MAX_PAGES ??
        DEFAULT_ROUTE_IMAGE_PAGE_LIMIT,
    );
    const routeImagePageLimit = Number.isFinite(routeImagePageLimitRaw) && routeImagePageLimitRaw > 0
      ? Math.floor(routeImagePageLimitRaw)
      : DEFAULT_ROUTE_IMAGE_PAGE_LIMIT;
    const sanitizedPdf = await sanitizePdfForParsing(buffer, {
      source: "/api/pdf/parse",
      formFieldMode: resolvePdfSanitizeFormFieldMode(process.env.PDF_SANITIZE_FORM_FIELDS_MODE),
      removeAnnotations: true,
      stripNonContentExtras: true,
      stripMetadata: true,
    });
    console.log("[/api/pdf/parse] PDF sanitization completed", {
      sourceFileName: report.name,
      inputBytes: sanitizedPdf?.diagnostics?.inputBytes ?? null,
      outputBytes: sanitizedPdf?.diagnostics?.outputBytes ?? null,
      sanitized: Boolean(sanitizedPdf?.sanitized),
      formFieldMode: sanitizedPdf?.diagnostics?.formFieldMode ?? null,
      annotationObjectsRemoved: sanitizedPdf?.diagnostics?.annotationObjectsRemoved ?? 0,
      formFieldsRemoved: sanitizedPdf?.diagnostics?.formFieldsRemoved ?? 0,
      formFieldsFlattened: sanitizedPdf?.diagnostics?.formFieldsFlattened ?? 0,
      reason: sanitizedPdf?.diagnostics?.reason || null,
    });

    const parsed = await parsePdf(sanitizedPdf.buffer, {
      imagePrimaryFullDocMaxPages: routeImagePageLimit,
      requireChartScoresForComplete: false,
      allowLocalTextFallback: true,
      enablePythonCrossCheck: true,
      ...(mode === ADMIN_INLINE_SAFE_MODE
        ? {
            disableImagePipeline: true,
            disableImageScoreRescue: true,
          }
        : {}),
    });
    const parsedWithSanitization = mergeSanitizationIntoParsedPayload(
      parsed,
      sanitizedPdf?.diagnostics || null,
    );
    const parseStatus = parsedWithSanitization?._parseStatus || "complete";
    const { parseCoverage, verificationSummary, parseNoise, parseState, parseReason } = buildParseContract(parsedWithSanitization);

    const result = {
      ...parsedWithSanitization,
      parseCoverage,
      verificationSummary,
      parseNoise,
      parseState,
      parseReason,
      parseSanitization: sanitizedPdf?.diagnostics || null,
      parsedAt: new Date().toISOString(),
      sourceFile: report.name,
      ...(clientId ? { clientId } : {}),
    };

    if (parseStatus !== "complete") {
      const incompleteReason = String(parsedWithSanitization?._parseDiagnostics?.incompleteReason || "PDF parsed but marked incomplete");
      return NextResponse.json(
        {
          success: false,
          error: incompleteReason,
          data: result,
          parseCoverage,
          verificationSummary,
          parseNoise,
          parseSanitization: sanitizedPdf?.diagnostics || null,
          parseState: parseState || "incomplete",
          parseReason: parseReason || incompleteReason,
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: result,
        parseCoverage,
        verificationSummary,
        parseNoise,
        parseSanitization: sanitizedPdf?.diagnostics || null,
        parseState: parseState || "complete",
        parseReason,
      },
      { status: 200 },
    );
  } catch (error) {
    console.log("[/api/pdf/parse error]", String(error?.message || error));
    const parseReason = String(error?.message || "PDF parsing failed");
    return NextResponse.json(
      {
        error: parseReason,
        parseCoverage: {
          parsedPages: null,
          detectedTotalPages: null,
          minExpectedPages: null,
          isCoverageComplete: false,
        },
        verificationSummary: {
          available: false,
          mismatchCount: 0,
          criticalMismatchCount: 0,
          criticalMismatchKeys: [],
        },
        parseNoise: null,
        parseState: "failed",
        parseReason,
      },
      { status: 500 },
    );
  }
}
