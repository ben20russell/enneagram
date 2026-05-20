import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { listVisibleReportsByUserEmail } from "../../lib/reportsStore";
import { authOptions } from "../api/auth/[...nextauth]/route";

export default async function Dashboard() {
  console.log("[dashboard] Loading dashboard page");

  const session = await getServerSession(authOptions);
  console.log("[dashboard] Session found:", !!session);

  if (!session || !session.user?.email) {
    console.log("[dashboard] Missing authenticated user. Redirecting to /");
    redirect("/");
  }

  let userReports = [];
  try {
    userReports = await listVisibleReportsByUserEmail(session.user.email);
  } catch (error) {
    console.log("[dashboard] Failed to fetch user reports", {
      details: String(error?.message || "Unknown dashboard query error"),
      stack: error?.stack,
    });
  }

  console.log("[dashboard] Reports fetched for user:", session.user.email, "count:", userReports.length);

  return (
    <div style={{ padding: "24px" }}>
      <h1>Your Enneagram Dashboard</h1>
      <p>Welcome, {session.user.name ?? session.user.email}</p>

      {userReports.length === 0 ? (
        <p>You have no reports yet. Take the test!</p>
      ) : (
        userReports.map((report) => (
          <div
            key={report.id}
            style={{ border: "1px solid #ccc", margin: "10px", padding: "10px" }}
          >
            <h2>
              {report.source === "admin-import"
                ? `Imported PDF: ${report.reportPdf?.fileName || "Report"}`
                : `Type: ${report.enneagramType ?? "Unknown"}`}
            </h2>
            {report.source !== "admin-import" && report.wing && <p>Wing: {report.wing}</p>}
          </div>
        ))
      )}
    </div>
  );
}
