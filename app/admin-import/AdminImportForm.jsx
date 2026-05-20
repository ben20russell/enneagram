"use client";

import { useMemo, useState } from "react";

const REQUEST_TIMEOUT_MS = 90_000;

export default function AdminImportForm() {
  const [email, setEmail] = useState("");
  const [reportPdf, setReportPdf] = useState(null);
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isFormValid = useMemo(() => {
    return !!email.trim() && !!reportPdf;
  }, [email, reportPdf]);

  async function handleImport(e) {
    e.preventDefault();
    if (!isFormValid) {
      setStatus("Please provide a valid email and a PDF report.");
      return;
    }

    setIsSubmitting(true);
    setStatus("Uploading report...");

    const formData = new FormData();
    formData.append("userEmail", email.trim());
    formData.append("reportPdf", reportPdf);

    console.log("[admin-import-page] Submitting import payload", {
      userEmail: email.trim(),
      fileName: reportPdf?.name,
      fileSize: reportPdf?.size,
      fileType: reportPdf?.type,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch("/api/admin-import", {
        method: "POST",
        body: formData,
        signal: controller.signal,
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
        setReportPdf(null);
        const fileInput = document.getElementById("admin-import-pdf");
        if (fileInput) {
          fileInput.value = "";
        }
      } else {
        setStatus(data?.error || "Failed to import.");
      }
    } catch (error) {
      console.log("[admin-import-page] Import failed", error);
      if (error?.name === "AbortError") {
        setStatus("Upload timed out. Please try again and check your network.");
      } else {
        setStatus("Network error while importing. Please try again.");
      }
    } finally {
      clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  }

  return (
    <div data-testid="admin-import-page" style={{ padding: "24px" }}>
      <h1 data-testid="admin-import-title">Manual Report Importer</h1>
      <p data-testid="admin-import-description">
        Use this hidden page to upload a PDF report and assign it to a specific user email.
      </p>

      <div
        data-testid="admin-import-card"
        style={{ border: "1px solid #ccc", margin: "10px 0", padding: "10px" }}
      >
        <form
          data-testid="admin-import-form"
          onSubmit={handleImport}
          style={{ display: "grid", gap: "12px" }}
        >
          <input
            data-testid="admin-import-email"
            type="email"
            placeholder="User email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: "10px", border: "1px solid #ccc" }}
          />

          <input
            data-testid="admin-import-pdf"
            id="admin-import-pdf"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const nextFile = e.target.files?.[0] || null;
              setReportPdf(nextFile);
              if (nextFile) {
                console.log("[admin-import-page] File selected", {
                  fileName: nextFile.name,
                  fileSize: nextFile.size,
                  fileType: nextFile.type,
                });
              }
            }}
            required
            style={{ padding: "10px", border: "1px solid #ccc" }}
          />

          <button
            data-testid="admin-import-submit"
            type="submit"
            disabled={!isFormValid || isSubmitting}
            style={{ border: "1px solid #ccc", padding: "10px", cursor: "pointer" }}
          >
            {isSubmitting ? "Assigning..." : "Assign Report"}
          </button>
        </form>
      </div>

      <p data-testid="admin-import-status">{status}</p>
    </div>
  );
}
