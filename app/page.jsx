import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { hasAdminImportedReports } from "../lib/reportsStore";
import { authOptions } from "./api/auth/[...nextauth]/route";
import PopupAuthBridge from "./components/PopupAuthBridge";

export default async function HomePage() {
  console.log("[home] Rendering embedded report page");

  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;

  if (userEmail) {
    try {
      const hasAssignedImportedReport = await hasAdminImportedReports(userEmail);
      console.log("[home] Assigned import report check", {
        userEmail,
        hasAssignedImportedReport,
      });
      if (hasAssignedImportedReport) {
        console.log("[home] Redirecting assigned user to dashboard to hide example reports");
        redirect("/dashboard");
      }
    } catch (error) {
      console.log("[home] Failed assigned report check; showing embedded report", {
        details: String(error?.message || "Unknown assigned report check error"),
        stack: error?.stack,
      });
    }
  }

  return (
    <main style={{ width: "100vw", minHeight: "100vh", margin: 0, padding: 0 }}>
      <PopupAuthBridge />
      <iframe
        title="Enneagram Report"
        src="/report.html"
        style={{ width: "100%", minHeight: "100vh", border: 0 }}
      />
    </main>
  );
}
