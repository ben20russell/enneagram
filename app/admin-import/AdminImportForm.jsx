"use client";

import { useMemo, useState } from "react";

function parseOptionalInt(value) {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export default function AdminImportForm() {
  const [email, setEmail] = useState("");
  const [type, setType] = useState("");
  const [wing, setWing] = useState("");
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isFormValid = useMemo(() => {
    if (!email.trim() || !type.trim() || !secret.trim()) return false;
    const typeValue = Number.parseInt(type, 10);
    return !Number.isNaN(typeValue) && typeValue >= 1 && typeValue <= 9;
  }, [email, type, secret]);

  async function handleImport(e) {
    e.preventDefault();
    if (!isFormValid) {
      setStatus("Please provide a valid email, type (1-9), and admin secret.");
      return;
    }

    setIsSubmitting(true);
    setStatus("Importing...");

    const payload = {
      userEmail: email.trim(),
      enneagramType: Number.parseInt(type, 10),
      wing: parseOptionalInt(wing),
    };

    console.log("[admin-import-page] Submitting import payload", payload);

    try {
      const res = await fetch("/api/admin-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": secret,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      console.log("[admin-import-page] API response", {
        ok: res.ok,
        status: res.status,
        data,
      });

      if (res.ok) {
        setStatus(`Success! Report assigned to ${email.trim().toLowerCase()}.`);
        setEmail("");
        setType("");
        setWing("");
      } else {
        setStatus(data?.error || "Failed to import.");
      }
    } catch (error) {
      console.log("[admin-import-page] Import failed", error);
      setStatus("Network error while importing. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      data-testid="admin-import-page"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#f8fafc",
      }}
    >
      <section
        data-testid="admin-import-card"
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "24px",
          boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
        }}
      >
        <h1 data-testid="admin-import-title" style={{ marginTop: 0 }}>
          Manual Report Importer
        </h1>
        <p data-testid="admin-import-description" style={{ color: "#475569" }}>
          Use this hidden page to assign a report to a specific user email.
        </p>

        <form
          data-testid="admin-import-form"
          onSubmit={handleImport}
          style={{ display: "grid", gap: "12px", marginTop: "16px" }}
        >
          <input
            data-testid="admin-import-email"
            type="email"
            placeholder="User email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
          />

          <input
            data-testid="admin-import-type"
            type="number"
            min="1"
            max="9"
            placeholder="Enneagram type (1-9)"
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
            style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
          />

          <input
            data-testid="admin-import-wing"
            type="number"
            min="1"
            max="9"
            placeholder="Wing (optional)"
            value={wing}
            onChange={(e) => setWing(e.target.value)}
            style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
          />

          <input
            data-testid="admin-import-secret"
            type="password"
            placeholder="Admin secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            required
            style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
          />

          <button
            data-testid="admin-import-submit"
            type="submit"
            disabled={!isFormValid || isSubmitting}
            style={{
              background: isFormValid && !isSubmitting ? "#0f172a" : "#64748b",
              color: "white",
              border: "none",
              padding: "10px 12px",
              borderRadius: "8px",
              cursor: isFormValid && !isSubmitting ? "pointer" : "not-allowed",
            }}
          >
            {isSubmitting ? "Assigning..." : "Assign Report"}
          </button>
        </form>

        <p
          data-testid="admin-import-status"
          style={{ marginTop: "14px", color: status.startsWith("Success") ? "#166534" : "#334155" }}
        >
          {status}
        </p>
      </section>
    </main>
  );
}
