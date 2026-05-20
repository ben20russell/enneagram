import PopupAuthBridge from "./components/PopupAuthBridge";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getAssignedReportByUserEmail } from "../lib/reportsStore";
import { authOptions } from "./api/auth/[...nextauth]/route";

export default async function HomePage() {
  console.log("[home] Rendering main page with example dashboard");

  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;

  if (userEmail) {
    let assignedReport = null;
    try {
      assignedReport = await getAssignedReportByUserEmail(userEmail);
    } catch (error) {
      console.log("[home] Assigned report lookup failed", {
        userEmail,
        details: String(error?.message || "Unknown assigned report lookup error"),
      });
    }

    const hasAssignedPdf =
      Boolean(assignedReport?.id) &&
      Boolean(assignedReport?.reportPdf?.fileName) &&
      Boolean(assignedReport?.reportPdf?.storagePath);

    if (hasAssignedPdf) {
      console.log("[home] Authenticated user with assigned PDF. Redirecting to /api/report-pdf");
      redirect("/api/report-pdf");
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
