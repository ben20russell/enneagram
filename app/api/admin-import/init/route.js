import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { adminBucket, adminDb } from "../../../../lib/firebaseAdmin";
import { authOptions } from "../../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../../lib/adminAccess";

export const maxDuration = 60;

function sanitizeFileName(name) {
  return String(name || "report.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function isPdfPayload(fileName, fileType) {
  const normalizedName = String(fileName || "").toLowerCase();
  const normalizedType = String(fileType || "").toLowerCase();
  return normalizedType === "application/pdf" || normalizedName.endsWith(".pdf");
}

export async function POST(req) {
  console.log("[admin-import:init] Incoming POST request");

  const session = await getServerSession(authOptions);
  const requesterEmail = normalizeEmail(session?.user?.email);

  if (!session || !requesterEmail || !hasAdminAccess(requesterEmail)) {
    console.log("[admin-import:init] Unauthorized requester", {
      hasSession: !!session,
      requesterEmail,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch (error) {
    console.log("[admin-import:init] Failed to parse JSON body", error);
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const userEmail = normalizeEmail(body?.userEmail);
  const rawFileName = String(body?.fileName || "report.pdf");
  const fileType = String(body?.fileType || "");
  const fileSize = Number(body?.fileSize || 0);

  if (!userEmail || !rawFileName || !fileType || !Number.isFinite(fileSize) || fileSize <= 0) {
    console.log("[admin-import:init] Missing required fields", {
      hasUserEmail: !!userEmail,
      hasFileName: !!rawFileName,
      hasFileType: !!fileType,
      fileSize,
    });
    return NextResponse.json(
      { error: "Missing user email or PDF file details" },
      { status: 400 },
    );
  }

  if (!isPdfPayload(rawFileName, fileType)) {
    console.log("[admin-import:init] Non-PDF file upload attempted", {
      fileName: rawFileName,
      fileType,
    });
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  try {
    const reportRef = adminDb.collection("reports").doc();
    const safeFileName = sanitizeFileName(rawFileName);
    const storagePath = `admin-import-reports/${reportRef.id}/${safeFileName}`;
    const file = adminBucket.file(storagePath);

    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType: "application/pdf",
    });

    console.log("[admin-import:init] Prepared signed upload URL", {
      reportId: reportRef.id,
      storagePath,
      assignedTo: userEmail,
      uploadedBy: requesterEmail,
      fileSize,
    });

    return NextResponse.json(
      {
        reportId: reportRef.id,
        userEmail,
        safeFileName,
        storagePath,
        mimeType: "application/pdf",
        sizeBytes: fileSize,
        uploadUrl,
        uploadHeaders: {
          "Content-Type": "application/pdf",
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.log("[admin-import:init] Failed to prepare signed upload", error);
    return NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 });
  }
}
