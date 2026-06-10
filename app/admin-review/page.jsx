import { redirect } from "next/navigation";

export default async function AdminReviewPage() {
  console.log("[admin-review-page] Redirecting legacy route to /admin#admin-review-section");
  redirect("/admin#admin-review-section");
}
