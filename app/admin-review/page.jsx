import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../api/auth/[...nextauth]/route";
import { hasAdminAccess } from "../../lib/adminAccess";
import AdminReviewPanel from "./AdminReviewPanel";

export default async function AdminReviewPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  const allowed = hasAdminAccess(email);

  console.log("[admin-review-page] Session check", {
    hasSession: !!session,
    email,
    allowed,
  });

  if (!session || !email || !allowed) {
    console.log("[admin-review-page] Unauthorized access attempt, redirecting to /");
    redirect("/");
  }

  return <AdminReviewPanel />;
}
