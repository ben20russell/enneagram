import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { createReport, getReportById } from "../../../lib/reportsStore";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../../lib/supabaseAdmin";
import { authOptions } from "../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../lib/adminAccess";

export const maxDuration = 60;

function sanitizeFileName(name) {
  return String(name || "report.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function isPdfFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function splitStoragePath(storagePath) {
  const normalized = String(storagePath || "").replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.pop() || "";
  const folder = parts.join("/");
  return { folder, fileName };
}

function inferTypeFromFileName(fileName) {
  const normalized = String(fileName || "");
  const ieqMatch = normalized.match(/iEQ\s*([1-9])\b/i);
  if (ieqMatch?.[1]) {
    return { detectedType: ieqMatch[1], detectionSource: "fileName:iEQ" };
  }

  const typeMatch = normalized.match(/Type[\s_-]*([1-9])\b/i);
  if (typeMatch?.[1]) {
    return { detectedType: typeMatch[1], detectionSource: "fileName:type" };
  }

  return { detectedType: null, detectionSource: "none" };
}

function buildIngestedResultsData({ reportId, safeFileName, storagePath, bucket, sizeBytes, mimeType }) {
  const { detectedType, detectionSource } = inferTypeFromFileName(safeFileName);

  return {
    ingestion: {
      status: "ready",
      mode: "admin-import-auto",
      ingestedAt: new Date().toISOString(),
      reportId,
    },
    dashboardContext: {
      detectedType,
      detectedTypeSource: detectionSource,
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

async function assertAdminRequest() {
  const session = await getServerSession(authOptions);
  const requesterEmail = normalizeEmail(session?.user?.email);

  if (!session || !requesterEmail || !hasAdminAccess(requesterEmail)) {
    return { requesterEmail, isAuthorized: false };
  }

  return { requesterEmail, isAuthorized: true };
}

async function ensureSupabaseFileExists({ supabaseAdmin, bucket, storagePath }) {
  const { folder, fileName } = splitStoragePath(storagePath);
  if (!fileName) return false;

  const { data, error } = await supabaseAdmin.storage.from(bucket).list(folder || undefined, {
    search: fileName,
    limit: 10,
  });

  if (error) {
    throw new Error(`Unable to verify uploaded PDF: ${error.message}`);
  }

  return (data || []).some((item) => item?.name === fileName);
}

async function finalizeImport({
  requesterEmail,
  reportId,
  userEmail,
  safeFileName,
  storagePath,
  mimeType,
  sizeBytes,
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const bucket = getSupabaseStorageBucket();

  const exists = await ensureSupabaseFileExists({
    supabaseAdmin,
    bucket,
    storagePath,
  });

  if (!exists) {
    console.log("[admin-import] Finalize failed, storage object missing", {
      reportId,
      bucket,
      storagePath,
    });
    return NextResponse.json(
      { error: "Uploaded PDF not found in storage. Please retry upload." },
      { status: 400 },
    );
  }

  const existingReport = await getReportById(reportId);

  if (existingReport) {
    console.log("[admin-import] Finalize rejected, report already exists", { reportId });
    return NextResponse.json({ error: "Report already imported" }, { status: 409 });
  }

  const report = await createReport({
    id: reportId,
    userEmail,
    enneagramType: inferTypeFromFileName(safeFileName).detectedType,
    wing: null,
    resultsData: buildIngestedResultsData({
      reportId,
      safeFileName,
      storagePath,
      bucket,
      sizeBytes,
      mimeType,
    }),
    reportPdf: {
      fileName: safeFileName,
      mimeType: mimeType || "application/pdf",
      sizeBytes,
      storageProvider: "supabase",
      bucket,
      storagePath,
      uploadedBy: requesterEmail,
    },
    source: "admin-import",
  });

  console.log("[admin-import] Report imported successfully", {
    id: report.id,
    storageProvider: "supabase",
    bucket,
    storagePath,
    sizeBytes,
  });

  return NextResponse.json(
    {
      id: report.id,
      message: `Successfully imported and assigned report to ${userEmail}`,
    },
    { status: 200 },
  );
}

async function handleFinalizeJson(req, requesterEmail) {
  let body;
  try {
    body = await req.json();
    console.log("[admin-import] Parsed JSON finalize payload");
  } catch (error) {
    console.log("[admin-import] Failed to parse JSON finalize payload", error);
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const reportId = String(body?.reportId || "").trim();
  const userEmail = normalizeEmail(body?.userEmail);
  const storagePath = String(body?.storagePath || "").trim();
  const mimeType = String(body?.mimeType || "application/pdf").toLowerCase();
  const sizeBytes = Number(body?.sizeBytes || 0);
  const safeFileName = sanitizeFileName(body?.safeFileName || "report.pdf");

  if (!reportId || !userEmail || !storagePath || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    console.log("[admin-import] Missing finalize fields", {
      hasReportId: !!reportId,
      hasUserEmail: !!userEmail,
      hasStoragePath: !!storagePath,
      sizeBytes,
    });
    return NextResponse.json(
      { error: "Missing finalize fields for report import" },
      { status: 400 },
    );
  }

  if (mimeType !== "application/pdf" && !safeFileName.toLowerCase().endsWith(".pdf")) {
    console.log("[admin-import] Finalize rejected non-PDF metadata", {
      mimeType,
      safeFileName,
    });
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  return finalizeImport({
    requesterEmail,
    reportId,
    userEmail,
    safeFileName,
    storagePath,
    mimeType,
    sizeBytes,
  });
}

async function handleLegacyMultipart(req, requesterEmail) {
  const supabaseAdmin = getSupabaseAdmin();
  const bucket = getSupabaseStorageBucket();

  let formData;
  try {
    formData = await req.formData();
    console.log("[admin-import] Parsed multipart form data (legacy path)");
  } catch (error) {
    console.log("[admin-import] Failed to parse multipart form data:", error);
    return NextResponse.json({ error: "Invalid form payload" }, { status: 400 });
  }

  const userEmail = normalizeEmail(formData.get("userEmail"));
  const reportPdf = formData.get("reportPdf");

  if (!userEmail || !reportPdf) {
    console.log("[admin-import] Missing required fields", {
      hasUserEmail: !!userEmail,
      hasReportPdf: !!reportPdf,
    });
    return NextResponse.json(
      { error: "Missing user email or PDF upload" },
      { status: 400 },
    );
  }

  if (!(reportPdf instanceof File)) {
    console.log("[admin-import] Uploaded report is not a File");
    return NextResponse.json({ error: "Invalid PDF upload" }, { status: 400 });
  }

  if (!isPdfFile(reportPdf)) {
    console.log("[admin-import] Non-PDF file upload attempted", {
      fileName: reportPdf.name,
      fileType: reportPdf.type,
    });
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  const reportId = randomUUID();
  const safeFileName = sanitizeFileName(reportPdf.name || "report.pdf");
  const storagePath = `${reportId}/${safeFileName}`;

  try {
    const { error } = await supabaseAdmin.storage.from(bucket).upload(storagePath, reportPdf, {
      contentType: "application/pdf",
      upsert: false,
    });

    if (error) {
      throw new Error(error.message || "Supabase upload failed");
    }

    return finalizeImport({
      requesterEmail,
      reportId,
      userEmail,
      safeFileName,
      storagePath,
      mimeType: "application/pdf",
      sizeBytes: reportPdf.size,
    });
  } catch (error) {
    const details = String(error?.message || "Unknown legacy upload error");
    console.log("[admin-import] Failed legacy multipart import", {
      details,
      stack: error?.stack,
    });
    return NextResponse.json(
      { error: "Failed to import", details },
      { status: 500 },
    );
  }
}

export async function POST(req) {
  console.log("[admin-import] Incoming POST request");

  const { requesterEmail, isAuthorized } = await assertAdminRequest();
  if (!isAuthorized) {
    console.log("[admin-import] Unauthorized requester", {
      requesterEmail,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = String(req.headers.get("content-type") || "").toLowerCase();

  try {
    if (contentType.includes("application/json")) {
      return await handleFinalizeJson(req, requesterEmail);
    }

    return await handleLegacyMultipart(req, requesterEmail);
  } catch (error) {
    const details = String(error?.message || "Unknown import error");
    console.log("[admin-import] Failed to import report:", {
      details,
      stack: error?.stack,
    });
    return NextResponse.json(
      { error: "Failed to import", details },
      { status: 500 },
    );
  }
}
