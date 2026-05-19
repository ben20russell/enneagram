import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "../auth/[...nextauth]/route";
import { adminDb } from "../../../lib/firebaseAdmin";

export async function POST(req: Request) {
  console.log("[save-report] Incoming POST request");

  const session = await getServerSession(authOptions);
  console.log("[save-report] Session found:", !!session);

  if (!session || !session.user?.email) {
    console.log("[save-report] Unauthorized request - missing session or email");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let testData: { type?: string; wing?: string | null; scores?: unknown };
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
    const newReportRef = adminDb.ref("reports").push();

    await newReportRef.set({
      userEmail: session.user.email,
      enneagramType: testData.type,
      wing: testData.wing || null,
      resultsData: testData.scores,
      createdAt: Date.now(),
    });

    console.log("[save-report] Report saved successfully:", newReportRef.key);
    return NextResponse.json(
      { id: newReportRef.key, message: "Report saved!" },
      { status: 200 },
    );
  } catch (error) {
    console.log("[save-report] Failed to save report:", error);
    return NextResponse.json(
      { error: "Failed to save report" },
      { status: 500 },
    );
  }
}
