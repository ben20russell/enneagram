import { FieldValue } from "firebase-admin/firestore";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../auth/[...nextauth]/route";
import { adminDb } from "../../../lib/firebaseAdmin";

export async function POST(req) {
  console.log("[save-report] Incoming POST request");

  const session = await getServerSession(authOptions);
  console.log("[save-report] Session found:", !!session);

  if (!session || !session.user?.email) {
    console.log("[save-report] Unauthorized request - missing session or email");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let testData;
  try {
    testData = await req.json();
    console.log("[save-report] Parsed request body");
  } catch (error) {
    console.log("[save-report] Failed to parse JSON body:", error);
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!testData?.type || !testData?.scores) {
    console.log("[save-report] Missing required fields", {
      hasType: !!testData?.type,
      hasScores: !!testData?.scores,
    });
    return NextResponse.json(
      { error: "Missing required fields: type and scores" },
      { status: 400 },
    );
  }

  try {
    const reportRef = await adminDb.collection("reports").add({
      userEmail: session.user.email,
      enneagramType: testData.type,
      wing: testData.wing || null,
      resultsData: testData.scores,
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log("[save-report] Report saved successfully:", reportRef.id);
    return NextResponse.json(
      { id: reportRef.id, message: "Report saved!" },
      { status: 200 },
    );
  } catch (error) {
    console.log("[save-report] Failed to save report:", error);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }
}
