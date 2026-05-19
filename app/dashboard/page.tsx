import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { adminDb } from "../../lib/firebaseAdmin";
import { authOptions } from "../api/auth/[...nextauth]/route";

type Report = {
  id: string;
  enneagramType?: string;
  wing?: string | null;
  userEmail?: string;
  createdAt?: unknown;
  resultsData?: unknown;
};

export default async function Dashboard() {
  console.log("[dashboard] Loading dashboard page");

  const session = await getServerSession(authOptions);
  console.log("[dashboard] Session found:", !!session);

  if (!session || !session.user?.email) {
    console.log("[dashboard] Missing authenticated user. Redirecting to /");
    redirect("/");
  }

  const snapshot = await adminDb
    .ref("reports")
    .orderByChild("userEmail")
    .equalTo(session.user.email)
    .once("value");

  const data = snapshot.val();

  let userReports: Report[] = [];
  if (data) {
    userReports = Object.keys(data).map((key) => ({
      id: key,
      ...(data[key] as Omit<Report, "id">),
    }));
    userReports.sort((a, b) => {
      const left = typeof a.createdAt === "number" ? a.createdAt : 0;
      const right = typeof b.createdAt === "number" ? b.createdAt : 0;
      return right - left;
    });
  }

  console.log(
    "[dashboard] Reports fetched for user:",
    session.user.email,
    "count:",
    userReports.length,
  );

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
            <h2>Type: {report.enneagramType ?? "Unknown"}</h2>
            {report.wing && <p>Wing: {report.wing}</p>}
            {typeof report.createdAt === "number" && (
              <p>Taken on: {new Date(report.createdAt).toLocaleDateString()}</p>
            )}
          </div>
        ))
      )}
    </div>
  );
}
