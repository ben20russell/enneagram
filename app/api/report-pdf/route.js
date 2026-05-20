import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getAssignedReportByUserEmail } from "../../../lib/reportsStore";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../../lib/supabaseAdmin";
import { authOptions } from "../auth/[...nextauth]/route";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;

  if (!userEmail) {
    return NextResponse.redirect(new URL("/", process.env.NEXTAUTH_URL || "http://127.0.0.1:3000"));
  }

  try {
    const assignedReport = await getAssignedReportByUserEmail(userEmail);
    const storagePath = assignedReport?.reportPdf?.storagePath || null;
    const bucket = assignedReport?.reportPdf?.bucket || getSupabaseStorageBucket();

    if (!storagePath) {
      return NextResponse.json(
        { error: "No assigned report PDF found for this account." },
        { status: 404 },
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 10);

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { error: "Failed to create signed URL for assigned report PDF." },
        { status: 500 },
      );
    }

    return NextResponse.redirect(data.signedUrl, 302);
  } catch (error) {
    return NextResponse.json(
      { error: String(error?.message || "Unknown report PDF error") },
      { status: 500 },
    );
  }
}
