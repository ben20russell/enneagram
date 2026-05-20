import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import AdminImportForm from "./AdminImportForm";
import { authOptions } from "../api/auth/[...nextauth]/route";
import { hasAdminAccess } from "../../lib/adminAccess";

export default async function AdminImportPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  const allowed = hasAdminAccess(email);

  console.log("[admin-import-page] Session check", {
    hasSession: !!session,
    email,
    allowed,
  });

  if (!session || !email || !allowed) {
    console.log("[admin-import-page] Unauthorized access attempt, redirecting to /");
    redirect("/");
  }

  return <AdminImportForm />;
}
