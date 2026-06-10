"use client";

import { useEffect } from "react";

export default function AdminError({ error, reset }) {
  useEffect(() => {
    console.log("[admin-page-error] Route segment error", error);
  }, [error]);

  return (
    <main
      data-testid="admin-page-error-boundary"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#f8fafc",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "560px",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Admin tools are temporarily unavailable</h2>
        <p style={{ color: "#475569" }}>
          We hit an unexpected issue while loading the admin page. Retry now or return to the dashboard.
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            data-testid="admin-page-error-retry"
            onClick={() => reset()}
            style={{
              marginTop: "8px",
              background: "#0f172a",
              color: "white",
              border: "none",
              padding: "10px 12px",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <a
            data-testid="admin-page-error-go-dashboard"
            href="/dashboard"
            style={{
              marginTop: "8px",
              background: "#ffffff",
              color: "#0f172a",
              border: "1px solid #cbd5e1",
              textDecoration: "none",
              padding: "10px 12px",
              borderRadius: "8px",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Go to Dashboard
          </a>
        </div>
      </section>
    </main>
  );
}
