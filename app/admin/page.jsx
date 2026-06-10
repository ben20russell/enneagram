import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../api/auth/[...nextauth]/route";
import AdminImportForm from "../admin-import/AdminImportForm";
import AdminReviewPanel from "../admin-review/AdminReviewPanel";
import { hasAdminAccess } from "../../lib/adminAccess";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  const allowed = hasAdminAccess(email);

  console.log("[admin-page] Session check", {
    hasSession: !!session,
    email,
    allowed,
  });

  if (!session || !email || !allowed) {
    console.log("[admin-page] Unauthorized access attempt, redirecting to /");
    redirect("/");
  }

  return (
    <main
      data-testid="admin-page"
      style={{
        padding: "20px 0 36px",
      }}
    >
      <section id="admin-import-section" data-testid="admin-import-section">
        <AdminImportForm />
      </section>

      <section
        data-testid="admin-sections-divider"
        style={{
          width: "100%",
          maxWidth: "980px",
          margin: "20px auto",
          padding: "0 20px",
        }}
      >
        <div
          style={{
            borderTop: "1px solid #cbd5e1",
            position: "relative",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: "-11px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#f8fafc",
              border: "1px solid #cbd5e1",
              borderRadius: "999px",
              color: "#334155",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.04em",
              padding: "2px 10px",
              textTransform: "uppercase",
            }}
          >
            Review Queue
          </span>
        </div>
      </section>

      <section id="admin-review-section" data-testid="admin-review-section">
        <AdminReviewPanel />
      </section>
    </main>
  );
}
