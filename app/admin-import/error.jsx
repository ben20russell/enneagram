"use client";

import { useEffect } from "react";

export default function AdminImportError({ error, reset }) {
  useEffect(() => {
    console.log("[admin-import-error] Route segment error", error);
  }, [error]);

  return (
    <main
      data-testid="admin-import-error-boundary"
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
          maxWidth: "520px",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
        <p style={{ color: "#475569" }}>
          The admin importer ran into an unexpected issue. Please try again.
        </p>
        <button
          data-testid="admin-import-error-retry"
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
      </section>
    </main>
  );
}
