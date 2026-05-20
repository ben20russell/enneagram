import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getAssignedReportByUserEmail } from "../../../lib/reportsStore";
import { authOptions } from "../auth/[...nextauth]/route";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;

  if (!userEmail) {
    return NextResponse.json(
      {
        isAuthenticated: false,
        isReportReady: false,
      },
      { status: 200 },
    );
  }

  try {
    const assignedReport = await getAssignedReportByUserEmail(userEmail);
    const isReportReady =
      Boolean(assignedReport?.id) &&
      Boolean(assignedReport?.reportPdf?.fileName) &&
      Boolean(assignedReport?.reportPdf?.storagePath);

    return NextResponse.json(
      {
        isAuthenticated: true,
        isReportReady,
        reportFileName: assignedReport?.reportPdf?.fileName || null,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        isAuthenticated: true,
        isReportReady: false,
        error: String(error?.message || "Unknown report-ready check error"),
      },
      { status: 200 },
    );
  }
}
