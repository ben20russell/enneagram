import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getAssignedReportByUserEmail } from "../../lib/reportsStore";
import { authOptions } from "../api/auth/[...nextauth]/route";
import DashboardUserHeader from "../components/DashboardUserHeader";

export default async function Dashboard() {
  console.log("[dashboard] Loading dashboard page");

  const session = await getServerSession(authOptions);
  console.log("[dashboard] Session found:", !!session);

  if (!session || !session.user?.email) {
    console.log("[dashboard] Missing authenticated user. Redirecting to /");
    redirect("/");
  }

  let assignedReport = null;
  try {
    assignedReport = await getAssignedReportByUserEmail(session.user.email);
  } catch (error) {
    console.log("[dashboard] Failed to fetch assigned report", {
      details: String(error?.message || "Unknown assigned report query error"),
      stack: error?.stack,
    });
  }

  console.log("[dashboard] Assigned report fetched for user:", {
    userEmail: session.user.email,
    assignedReportId: assignedReport?.id || null,
  });

  const isAssignedReportActive =
    Boolean(assignedReport?.id) &&
    Boolean(assignedReport?.reportPdf?.fileName) &&
    Boolean(assignedReport?.reportPdf?.storagePath);

  console.log("[dashboard] Assigned report active state:", {
    userEmail: session.user.email,
    isAssignedReportActive,
  });

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }} data-testid="dashboard-root">
      <h1 data-testid="dashboard-title">Your Assigned Report</h1>
      <DashboardUserHeader
        userName={session.user.name}
        userEmail={session.user.email}
        userImage={session.user.image}
        showReportActiveFlash={isAssignedReportActive}
      />

      {!assignedReport ? (
        <div
          data-testid="dashboard-empty-state"
          style={{
            border: "1px solid #d6e2ef",
            borderRadius: "12px",
            padding: "16px",
            marginTop: "12px",
            background: "#f8fbff",
          }}
        >
          <p style={{ margin: 0, color: "#36506f" }}>
            No report has been assigned to your account yet. Please contact your administrator.
          </p>
        </div>
      ) : (
        <div
          data-testid="assigned-report-card"
          style={{
            border: "1px solid #d6e2ef",
            borderRadius: "12px",
            padding: "16px",
            marginTop: "12px",
            background: "#ffffff",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "8px" }}>
            {assignedReport.reportPdf?.fileName || "Assigned Report"}
          </h2>
          <p style={{ margin: "0 0 8px 0", color: "#36506f" }}>
            Assigned to: {assignedReport.userEmail}
          </p>
          <p style={{ margin: 0, color: "#5d7694" }}>
            Uploaded:{" "}
            {assignedReport.createdAt
              ? new Date(assignedReport.createdAt).toLocaleString()
              : "Unknown"}
          </p>
        </div>
      )}
    </div>
  );
}
