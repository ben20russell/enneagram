import { FieldValue } from "firebase-admin/firestore";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { adminBucket, adminDb } from "../../../lib/firebaseAdmin";
import { authOptions } from "../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../lib/adminAccess";

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;

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

export async function POST(req) {
  console.log("[admin-import] Incoming POST request");

  const session = await getServerSession(authOptions);
  const requesterEmail = normalizeEmail(session?.user?.email);

  if (!session || !requesterEmail || !hasAdminAccess(requesterEmail)) {
    console.log("[admin-import] Unauthorized requester", {
      hasSession: !!session,
      requesterEmail,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData;
  try {
    formData = await req.formData();
    console.log("[admin-import] Parsed multipart form data");
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

  if (reportPdf.size > MAX_PDF_SIZE_BYTES) {
    console.log("[admin-import] PDF file exceeds size limit", {
      size: reportPdf.size,
      max: MAX_PDF_SIZE_BYTES,
    });
    return NextResponse.json(
      { error: "PDF is too large. Max size is 10MB." },
      { status: 400 },
    );
  }

  try {
    const reportRef = adminDb.collection("reports").doc();
    const safeFileName = sanitizeFileName(reportPdf.name || "report.pdf");
    const storagePath = `admin-import-reports/${reportRef.id}/${safeFileName}`;
    const pdfBuffer = Buffer.from(await reportPdf.arrayBuffer());

    console.log("[admin-import] Uploading PDF to Firebase Storage", {
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

    await reportRef.set({
      userEmail,
      enneagramType: null,
      wing: null,
      resultsData: "PDF uploaded via admin import",
      reportPdf: {
        fileName: safeFileName,
        mimeType: "application/pdf",
        sizeBytes: reportPdf.size,
        storagePath,
        uploadedBy: requesterEmail,
      },
      createdAt: FieldValue.serverTimestamp(),
      source: "admin-import",
    });

    console.log("[admin-import] Report imported successfully", { id: reportRef.id });
    return NextResponse.json(
      {
        id: reportRef.id,
        message: `Successfully imported and assigned report to ${userEmail}`,
      },
      { status: 200 },
    );
  } catch (error) {
    console.log("[admin-import] Failed to import report:", error);
    return NextResponse.json({ error: "Failed to import" }, { status: 500 });
  }
}
