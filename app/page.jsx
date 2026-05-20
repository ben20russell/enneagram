import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./api/auth/[...nextauth]/route";
import LoginButton from "./components/LoginButton";
import RandomExampleReportPreview from "./components/RandomExampleReportPreview";

export default async function HomePage() {
  console.log("[home] Rendering sign-in landing page");

  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    console.log("[home] Authenticated user detected, redirecting to /dashboard");
    redirect("/dashboard");
  }

  return (
    <main
      style={{
        width: "100vw",
        minHeight: "100vh",
        margin: 0,
        padding: "24px",
        display: "grid",
        placeItems: "center",
        background: "#f8fbff",
      }}
      data-testid="home-root"
    >
      <div
        style={{
          width: "100%",
          maxWidth: "540px",
          background: "#ffffff",
          border: "1px solid #d6e2ef",
          borderRadius: "16px",
          padding: "28px",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: "0 0 10px 0", color: "#10223d" }}>Enneagram Dashboard</h1>
        <p style={{ margin: "0 0 18px 0", color: "#36506f" }}>
          Sign in to access your assigned report.
        </p>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <LoginButton />
        </div>
        <RandomExampleReportPreview />
      </div>
    </main>
  );
}
