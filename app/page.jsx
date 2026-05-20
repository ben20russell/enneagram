import { getServerSession } from "next-auth";
import { getAssignedReportByUserEmail } from "../lib/reportsStore";
import { authOptions } from "./api/auth/[...nextauth]/route";
import DashboardUserHeader from "./components/DashboardUserHeader";
import PopupAuthBridge from "./components/PopupAuthBridge";

const dashboardLayoutStyle = {
  padding: "24px",
  maxWidth: "900px",
  margin: "0 auto",
};

const cardBaseStyle = {
  border: "1px solid #d6e2ef",
  borderRadius: "12px",
  padding: "16px",
  marginTop: "12px",
};

const emptyCardStyle = {
  ...cardBaseStyle,
  background: "#f8fbff",
};

const assignedCardStyle = {
  ...cardBaseStyle,
  background: "#ffffff",
};

function formatAssignedReportDate(createdAt) {
  if (!createdAt) {
    return "Unknown";
  }

  return new Date(createdAt).toLocaleString();
}

export default async function HomePage() {
  console.log("[home] Rendering main page");

  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;
  console.log("[home] Session resolved", {
    hasSession: Boolean(session),
    userEmail,
  });

  if (userEmail) {
    let assignedReport = null;
    try {
      assignedReport = await getAssignedReportByUserEmail(userEmail);
      console.log("[home] Assigned report lookup complete", {
        userEmail,
        hasAssignedReport: Boolean(assignedReport),
      });
    } catch (error) {
      console.log("[home] Failed to fetch assigned report", {
        details: String(error?.message || "Unknown assigned report query error"),
        stack: error?.stack,
      });
    }

    const isAssignedReportActive =
      Boolean(assignedReport?.id) &&
      Boolean(assignedReport?.reportPdf?.fileName) &&
      Boolean(assignedReport?.reportPdf?.storagePath);

    return (
      <div style={dashboardLayoutStyle} data-testid="dashboard-root">
        <h1 data-testid="dashboard-title">Your Assigned Report</h1>
        <DashboardUserHeader
          userName={session.user.name}
          userEmail={userEmail}
          userImage={session.user.image}
          showReportActiveFlash={isAssignedReportActive}
        />

        {!assignedReport ? (
          <div data-testid="dashboard-empty-state" style={emptyCardStyle}>
            <p style={{ margin: 0, color: "#36506f" }}>
              No report has been assigned to your account yet. Please contact your administrator.
            </p>
          </div>
        ) : (
          <div data-testid="assigned-report-card" style={assignedCardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: "8px" }}>
              {assignedReport.reportPdf?.fileName || "Assigned Report"}
            </h2>
            <p style={{ margin: "0 0 8px 0", color: "#36506f" }}>
              Assigned to: {assignedReport.userEmail}
            </p>
            <p style={{ margin: 0, color: "#5d7694" }}>
              Uploaded: {formatAssignedReportDate(assignedReport.createdAt)}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <main style={{ width: "100vw", minHeight: "100vh", margin: 0, padding: 0 }} data-testid="home-root">
      <PopupAuthBridge />
      <iframe
        title="Enneagram Example Dashboard"
        src="/report.html"
        style={{ width: "100%", minHeight: "100vh", border: 0 }}
      />
    </main>
  );
}
