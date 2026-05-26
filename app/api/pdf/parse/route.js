import { NextResponse } from "next/server";
import { parsePdf } from "../../../../lib/parsePdf.js";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

function isPdfFile(file) {
  return file instanceof File && file.type === "application/pdf";
}

export async function POST(req) {
  try {
    const formData = await req.formData();
    const report = formData.get("report");
    const clientId = String(formData.get("clientId") || "").trim() || null;

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
    const parsed = await parsePdf(buffer);
    const parseStatus = parsed?._parseStatus || "complete";

    const result = {
      ...parsed,
      parsedAt: new Date().toISOString(),
      sourceFile: report.name,
      ...(clientId ? { clientId } : {}),
    };

    if (parseStatus !== "complete") {
      return NextResponse.json(
        { success: false, error: "PDF parsed but marked incomplete", data: result },
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
