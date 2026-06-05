import { NextResponse } from "next/server";
import { parsePdf } from "../../../../lib/parsePdf.js";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const DEFAULT_ROUTE_IMAGE_PAGE_LIMIT = 24;
const ADMIN_INLINE_SAFE_MODE = "admin-inline-safe";

function isPdfFile(file) {
  return file instanceof File && file.type === "application/pdf";
}

function toPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
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

  return { parseCoverage, verificationSummary, parseState, parseReason };
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
    const parsed = await parsePdf(buffer, {
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
    const parseStatus = parsed?._parseStatus || "complete";
    const { parseCoverage, verificationSummary, parseState, parseReason } = buildParseContract(parsed);

    const result = {
      ...parsed,
      parseCoverage,
      verificationSummary,
      parseState,
      parseReason,
      parsedAt: new Date().toISOString(),
      sourceFile: report.name,
      ...(clientId ? { clientId } : {}),
    };

    if (parseStatus !== "complete") {
      const incompleteReason = String(parsed?._parseDiagnostics?.incompleteReason || "PDF parsed but marked incomplete");
      return NextResponse.json(
        {
          success: false,
          error: incompleteReason,
          data: result,
          parseCoverage,
          verificationSummary,
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
        parseState: "failed",
        parseReason,
      },
      { status: 500 },
    );
  }
}
