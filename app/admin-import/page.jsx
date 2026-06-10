import { redirect } from "next/navigation";

export default async function AdminImportPage() {
  console.log("[admin-import-page] Redirecting legacy route to /admin");
  redirect("/admin");
}
