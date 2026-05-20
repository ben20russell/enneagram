import { FieldValue } from "firebase-admin/firestore";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { adminBucket, adminDb } from "../../../lib/firebaseAdmin";
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

async function assertAdminRequest() {
  const session = await getServerSession(authOptions);
  const requesterEmail = normalizeEmail(session?.user?.email);

  if (!session || !requesterEmail || !hasAdminAccess(requesterEmail)) {
    return { requesterEmail, isAuthorized: false };
  }

  return { requesterEmail, isAuthorized: true };
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
  const file = adminBucket.file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    console.log("[admin-import] Finalize failed, storage object missing", {
      reportId,
      storagePath,
    });
    return NextResponse.json(
      { error: "Uploaded PDF not found in storage. Please retry upload." },
      { status: 400 },
    );
  }

  await file.setMetadata({
    contentType: "application/pdf",
    metadata: {
      assignedTo: userEmail,
      uploadedBy: requesterEmail,
      source: "admin-import",
    },
  });

  const reportRef = adminDb.collection("reports").doc(reportId);
  const existingReport = await reportRef.get();

  if (existingReport.exists) {
    console.log("[admin-import] Finalize rejected, report already exists", { reportId });
    return NextResponse.json({ error: "Report already imported" }, { status: 409 });
  }

  await reportRef.set({
    userEmail,
    enneagramType: null,
    wing: null,
    resultsData: "PDF uploaded via admin import",
    reportPdf: {
      fileName: safeFileName,
      mimeType: mimeType || "application/pdf",
      sizeBytes,
      storagePath,
      uploadedBy: requesterEmail,
    },
    createdAt: FieldValue.serverTimestamp(),
    source: "admin-import",
  });

  console.log("[admin-import] Report imported successfully", {
    id: reportId,
    storagePath,
    sizeBytes,
  });

  return NextResponse.json(
    {
      id: reportId,
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

  const reportRef = adminDb.collection("reports").doc();
  const safeFileName = sanitizeFileName(reportPdf.name || "report.pdf");
  const storagePath = `admin-import-reports/${reportRef.id}/${safeFileName}`;

  try {
    const pdfBuffer = Buffer.from(await reportPdf.arrayBuffer());

    console.log("[admin-import] Uploading PDF via legacy multipart path", {
      reportId: reportRef.id,
      storagePath,
      size: reportPdf.size,
      uploadedBy: requesterEmail,
      assignedTo: userEmail,
    });

    await adminBucket.file(storagePath).save(pdfBuffer, {
      resumable: false,
      contentType: "application/pdf",
      metadata: {
        metadata: {
          assignedTo: userEmail,
          uploadedBy: requesterEmail,
          source: "admin-import",
        },
      },
    });

    return finalizeImport({
      requesterEmail,
      reportId: reportRef.id,
      userEmail,
      safeFileName,
      storagePath,
      mimeType: "application/pdf",
      sizeBytes: reportPdf.size,
    });
  } catch (error) {
    console.log("[admin-import] Failed legacy multipart import", error);
    return NextResponse.json({ error: "Failed to import" }, { status: 500 });
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
    console.log("[admin-import] Failed to import report:", error);
    return NextResponse.json({ error: "Failed to import" }, { status: 500 });
  }
}
