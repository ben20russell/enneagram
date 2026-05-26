import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../../../lib/supabaseAdmin";
import { authOptions } from "../../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../../lib/adminAccess";

export const runtime = "nodejs";
export const maxDuration = 60;

function sanitizeFileName(name) {
  return String(name || "report.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function inferTypeFromFileName(fileName) {
  const normalized = String(fileName || "");
  const ieqMatch = normalized.match(/iEQ\s*([1-9])\b/i);
  if (ieqMatch?.[1]) return ieqMatch[1];
  const typeMatch = normalized.match(/Type[\s_-]*([1-9])\b/i);
  if (typeMatch?.[1]) return typeMatch[1];
  return null;
}

function isMissingSourceColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) return false;
  const referencesSourceColumn =
    message.includes("'source'") || message.includes("\"source\"") || message.includes(" source ");
  const referencesMissingColumn =
    message.includes("column") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"));
  return referencesSourceColumn && referencesMissingColumn;
}

function buildIngestionMetadata({ reportId, safeFileName, storagePath, bucket, sizeBytes, mimeType }) {
  return {
    ingestion: {
      status: "incomplete",
      mode: "admin-import-auto",
      ingestedAt: new Date().toISOString(),
      reportId,
      parseDiagnostics: {
        isComplete: false,
        incompleteReason: "Report metadata imported; parser deferred.",
        extraction: {
          pages: 0,
          minExpectedPages: Number(process.env.PDF_PARSE_MIN_PAGES || 20),
        },
      },
    },
    dashboardContext: {
      detectedType: inferTypeFromFileName(safeFileName),
      detectedTypeSource: "fileName",
      sourceFileName: safeFileName,
      basicFear: null,
      basicDesire: null,
      passion: null,
    },
    review: {
      status: "needs_review",
      pendingFields: [],
      generatedAt: new Date().toISOString(),
    },
    file: {
      bucket,
      storagePath,
      fileName: safeFileName,
      sizeBytes,
      mimeType: mimeType || "application/pdf",
    },
  };
}

export async function POST(req) {
  console.log("[admin-import:finalize-lite] Incoming POST request");

  const session = await getServerSession(authOptions);
  const requesterEmail = normalizeEmail(session?.user?.email);
  if (!session || !requesterEmail || !hasAdminAccess(requesterEmail)) {
    console.log("[admin-import:finalize-lite] Unauthorized requester", { requesterEmail });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch (error) {
    console.log("[admin-import:finalize-lite] Failed to parse JSON body", error);
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const reportId = String(body?.reportId || "").trim();
  const userEmail = normalizeEmail(body?.userEmail);
  const storagePath = String(body?.storagePath || "").trim();
  const mimeType = String(body?.mimeType || "application/pdf").toLowerCase();
  const sizeBytes = Number(body?.sizeBytes || 0);
  const safeFileName = sanitizeFileName(body?.safeFileName || "report.pdf");

  if (!reportId || !userEmail || !storagePath || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json(
      { error: "Missing finalize fields for report import" },
      { status: 400 },
    );
  }

  if (mimeType !== "application/pdf" && !safeFileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  const reportsTable = process.env.SUPABASE_REPORTS_TABLE || "reports";
  const bucket = getSupabaseStorageBucket();
  const supabaseAdmin = getSupabaseAdmin();

  const payload = {
    id: reportId,
    user_email: userEmail,
    enneagram_type: inferTypeFromFileName(safeFileName),
    wing: null,
    results_data: buildIngestionMetadata({
      reportId,
      safeFileName,
      storagePath,
      bucket,
      sizeBytes,
      mimeType,
    }),
    report_pdf: {
      fileName: safeFileName,
      mimeType: mimeType || "application/pdf",
      sizeBytes,
      storageProvider: "supabase",
      bucket,
      storagePath,
      uploadedBy: requesterEmail,
    },
    source: "admin-import",
    created_at: new Date().toISOString(),
  };

  try {
    let { data, error } = await supabaseAdmin.from(reportsTable).insert(payload).select("id").single();

    if (error && isMissingSourceColumnError(error)) {
      console.log("[admin-import:finalize-lite] Source column missing; retrying insert without source");
      const { source: _ignoredSource, ...payloadWithoutSource } = payload;
      const retryResult = await supabaseAdmin
        .from(reportsTable)
        .insert(payloadWithoutSource)
        .select("id")
        .single();
      data = retryResult.data;
      error = retryResult.error;
    }

    if (error) {
      const message = String(error?.message || "").toLowerCase();
      if (message.includes("duplicate key") || message.includes("already exists")) {
        return NextResponse.json({ error: "Report already imported" }, { status: 409 });
      }
      throw new Error(error?.message || "Finalize lite insert failed");
    }

    return NextResponse.json(
      {
        id: data?.id || reportId,
        message: `Successfully imported and assigned report to ${userEmail}`,
      },
      { status: 200 },
    );
  } catch (error) {
    const details = String(error?.message || "Unknown finalize-lite error");
    console.log("[admin-import:finalize-lite] Failed", {
      details,
      reportsTable,
      stack: error?.stack,
    });
    return NextResponse.json(
      { error: "Failed to import", details, reportsTable },
      { status: 500 },
    );
  }
}
