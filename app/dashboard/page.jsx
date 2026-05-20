import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../api/auth/[...nextauth]/route";

export default async function Dashboard() {
  console.log("[dashboard] Route moved to /. Redirecting /dashboard to main page.");

  const session = await getServerSession(authOptions);
  console.log("[dashboard] Session found:", !!session);
  redirect("/");
}
