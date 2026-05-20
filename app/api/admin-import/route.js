import { FieldValue } from "firebase-admin/firestore";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { adminDb } from "../../../lib/firebaseAdmin";
import { authOptions } from "../auth/[...nextauth]/route";
import { hasAdminAccess, normalizeEmail } from "../../../lib/adminAccess";

function parseOptionalInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
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

  const adminSecret = process.env.ADMIN_IMPORT_SECRET;
  const requestSecret = req.headers.get("x-admin-secret");

  if (!adminSecret) {
    console.log("[admin-import] Missing ADMIN_IMPORT_SECRET env var");
    return NextResponse.json(
      { error: "Admin import is not configured." },
      { status: 500 },
    );
  }

  if (!requestSecret || requestSecret !== adminSecret) {
    console.log("[admin-import] Unauthorized import attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
    console.log("[admin-import] Parsed request body");
  } catch (error) {
    console.log("[admin-import] Failed to parse JSON body:", error);
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const userEmail = normalizeEmail(body?.userEmail);
  const enneagramType = Number.parseInt(String(body?.enneagramType ?? ""), 10);
  const wing = parseOptionalInt(body?.wing);

  if (!userEmail || Number.isNaN(enneagramType)) {
    console.log("[admin-import] Missing or invalid fields", {
      hasUserEmail: !!userEmail,
      enneagramType,
    });
    return NextResponse.json(
      { error: "Missing or invalid email/type" },
      { status: 400 },
    );
  }

  if (enneagramType < 1 || enneagramType > 9) {
    console.log("[admin-import] Enneagram type out of range", { enneagramType });
    return NextResponse.json(
      { error: "Enneagram type must be between 1 and 9" },
      { status: 400 },
    );
  }

  if (wing !== null && (wing < 1 || wing > 9)) {
    console.log("[admin-import] Wing out of range", { wing });
    return NextResponse.json(
      { error: "Wing must be between 1 and 9 when provided" },
      { status: 400 },
    );
  }

  try {
    const reportRef = adminDb.collection("reports").doc();

    await reportRef.set({
      userEmail,
      enneagramType,
      wing,
      resultsData: body?.resultsData || "Manually Imported",
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
