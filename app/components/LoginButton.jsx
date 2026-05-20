"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { hasAdminAccess, normalizeEmail } from "../../lib/adminAccess";

export default function LoginButton() {
  const { data: session, status } = useSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const userEmail = normalizeEmail(session?.user?.email);
  const isAdmin = useMemo(() => hasAdminAccess(userEmail), [userEmail]);
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
          position: "relative",
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
        <button
          data-testid="account-menu-toggle"
          onClick={() => setIsMenuOpen((prev) => !prev)}
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
          Account
        </button>
        {isMenuOpen ? (
          <div
            data-testid="account-dropdown-menu"
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: "8px",
              minWidth: "170px",
              background: "#ffffff",
              border: "1px solid #d6e2ef",
              borderRadius: "10px",
              boxShadow: "0 12px 24px rgba(16, 34, 61, 0.12)",
              padding: "8px",
              display: "grid",
              gap: "6px",
              zIndex: 10,
            }}
          >
            <Link
              data-testid="dashboard-link"
              href="/dashboard"
              onClick={() => setIsMenuOpen(false)}
              style={{
                textDecoration: "none",
                color: "#0a66d8",
                fontSize: "12px",
                fontWeight: 600,
                padding: "6px 8px",
                borderRadius: "8px",
              }}
            >
              Dashboard
            </Link>
            {isAdmin ? (
              <Link
                data-testid="admin-import-link"
                href="/admin-import"
                onClick={() => setIsMenuOpen(false)}
                style={{
                  textDecoration: "none",
                  color: "#0a66d8",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "6px 8px",
                  borderRadius: "8px",
                }}
              >
                Admin Page
              </Link>
            ) : null}
            <button
              data-testid="sign-out"
              onClick={() => signOut()}
              style={{
                border: "1px solid #b8cae0",
                borderRadius: "8px",
                background: "#ffffff",
                color: "#10223d",
                fontSize: "12px",
                fontWeight: 600,
                padding: "6px 8px",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Sign Out
            </button>
          </div>
        ) : null}
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
      Sign in with Google
    </button>
  );
}
