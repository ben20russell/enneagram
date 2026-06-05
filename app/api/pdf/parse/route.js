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

    const result = {
      ...parsed,
      parsedAt: new Date().toISOString(),
      sourceFile: report.name,
      ...(clientId ? { clientId } : {}),
    };

    if (parseStatus !== "complete") {
      const incompleteReason = String(parsed?._parseDiagnostics?.incompleteReason || "PDF parsed but marked incomplete");
      return NextResponse.json(
        { success: false, error: incompleteReason, data: result },
        { status: 422 },
      );
    }

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    console.log("[/api/pdf/parse error]", String(error?.message || error));
    return NextResponse.json(
      { error: String(error?.message || "PDF parsing failed") },
      { status: 500 },
    );
  }
}
