"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

export default function LoginButton() {
  const { data: session, status } = useSession();
  console.log("[auth] session state", session ? "authenticated" : "anonymous");

  if (status === "loading") {
    return (
      <div
        data-testid="auth-loading"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "#ffffff",
          border: "1px solid #d6e2ef",
          borderRadius: "12px",
          padding: "8px 12px",
        }}
      >
        <span style={{ color: "#5d7694", fontSize: "12px" }}>Checking session...</span>
      </div>
    );
  }

  if (session) {
    return (
      <div
        data-testid="auth-session"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: "#ffffff",
          border: "1px solid #d6e2ef",
          borderRadius: "12px",
          padding: "8px 12px",
          boxShadow: "0 8px 22px rgba(16, 34, 61, 0.1)",
        }}
      >
        <p style={{ margin: 0, color: "#36506f", fontSize: "12px" }}>
          Welcome, {session.user?.name ?? session.user?.email}
        </p>
        <Link
          data-testid="dashboard-link"
          href="/dashboard"
          style={{
            textDecoration: "none",
            color: "#0a66d8",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          Dashboard
        </Link>
        <button
          data-testid="sign-out"
          onClick={() => signOut()}
          style={{
            border: "1px solid #b8cae0",
            borderRadius: "10px",
            background: "#ffffff",
            color: "#10223d",
            fontSize: "12px",
            fontWeight: 600,
            padding: "6px 10px",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      data-testid="sign-in-google"
      onClick={() => signIn("google")}
      style={{
        border: "1px solid #0a66d8",
        borderRadius: "10px",
        background: "#0a66d8",
        color: "#ffffff",
        fontSize: "12px",
        fontWeight: 700,
        padding: "8px 12px",
        cursor: "pointer",
        boxShadow: "0 8px 22px rgba(10, 102, 216, 0.25)",
      }}
    >
      Sign In
    </button>
  );
}
