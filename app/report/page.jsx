import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getAssignedReportByUserEmail } from "../../lib/reportsStore";
import { authOptions } from "../api/auth/[...nextauth]/route";

export default async function ReportPage() {
  console.log("[report] Rendering /report route");

  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;

  if (!userEmail) {
    console.log("[report] Missing authenticated user. Redirecting to /");
    redirect("/");
  }

  let assignedReport = null;
  try {
    assignedReport = await getAssignedReportByUserEmail(userEmail);
  } catch (error) {
    console.log("[report] Failed assigned report lookup", {
      userEmail,
      details: String(error?.message || "Unknown assigned report lookup error"),
      stack: error?.stack,
    });
  }

  const hasAssignedPdf =
    Boolean(assignedReport?.id) &&
    Boolean(assignedReport?.reportPdf?.fileName) &&
    Boolean(assignedReport?.reportPdf?.storagePath);

  if (hasAssignedPdf) {
    console.log("[report] Assigned PDF found. Redirecting to /api/report", {
      userEmail,
      storagePath: assignedReport.reportPdf.storagePath,
    });
    redirect("/api/report");
  }

  return (
    <main
      style={{
        maxWidth: "900px",
        margin: "0 auto",
        minHeight: "100vh",
        padding: "24px",
        display: "flex",
        alignItems: "flex-start",
      }}
      data-testid="report-page-no-assignment"
    >
      <div
        style={{
          marginTop: "24px",
          border: "1px solid #d6e2ef",
          borderRadius: "12px",
          padding: "16px",
          width: "100%",
          background: "#f8fbff",
        }}
      >
        <p style={{ margin: 0, color: "#36506f" }}>
          No report has been assigned to your account yet. Please contact your administrator.
        </p>
      </div>
    </main>
  );
}
