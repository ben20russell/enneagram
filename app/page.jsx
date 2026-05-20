import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./api/auth/[...nextauth]/route";
import LoginButton from "./components/LoginButton";
import RandomExampleReportPreview from "./components/RandomExampleReportPreview";

export default async function HomePage() {
  console.log("[home] Rendering dashboard-style example opening page");

  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    console.log("[home] Authenticated user detected, redirecting to /dashboard");
    redirect("/dashboard");
  }

  return (
    <main
      style={{
        width: "100%",
        minHeight: "100vh",
        margin: 0,
        padding: "24px",
        background: "#f8fbff",
      }}
      data-testid="home-root"
    >
      <div
        style={{
          width: "100%",
          maxWidth: "900px",
          margin: "0 auto",
          background: "#ffffff",
          border: "1px solid #d6e2ef",
          borderRadius: "16px",
          padding: "28px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: "0 0 8px 0", color: "#10223d" }}>Enneagram Dashboard</h1>
            <p style={{ margin: 0, color: "#36506f" }}>
              Opening preview: example dashboard report. Sign in to view your assigned report.
            </p>
          </div>
          <LoginButton />
        </div>
        <RandomExampleReportPreview />
      </div>
    </main>
  );
}
