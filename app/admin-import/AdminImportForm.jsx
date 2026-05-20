"use client";

import { useMemo, useState } from "react";

const API_REQUEST_TIMEOUT_MS = 90_000;
const UPLOAD_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

function clearTimeoutController(timeoutId) {
  clearTimeout(timeoutId);
}

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

    const normalizedEmail = email.trim().toLowerCase();

    setIsSubmitting(true);
    setStatus("Preparing upload...");

    console.log("[admin-import-page] Starting signed upload flow", {
      userEmail: normalizedEmail,
      fileName: reportPdf?.name,
      fileSize: reportPdf?.size,
      fileType: reportPdf?.type,
    });

    try {
      const initTimeout = createTimeoutController(API_REQUEST_TIMEOUT_MS);
      let initRes;
      let initData;

      try {
        initRes = await fetch("/api/admin-import/init", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userEmail: normalizedEmail,
            fileName: reportPdf.name,
            fileType: reportPdf.type,
            fileSize: reportPdf.size,
          }),
          signal: initTimeout.controller.signal,
        });
        initData = await initRes.json().catch(() => ({}));
      } finally {
        clearTimeoutController(initTimeout.timeoutId);
      }

      console.log("[admin-import-page] Init response", {
        ok: initRes.ok,
        status: initRes.status,
        data: initData,
      });

      if (!initRes.ok) {
        setStatus(initData?.error || "Failed to prepare upload.");
        return;
      }

      setStatus("Uploading PDF to storage...");

      const uploadTimeout = createTimeoutController(UPLOAD_REQUEST_TIMEOUT_MS);
      let uploadRes;
      try {
        uploadRes = await fetch(initData.uploadUrl, {
          method: "PUT",
          headers: initData.uploadHeaders || { "Content-Type": "application/pdf" },
          body: reportPdf,
          signal: uploadTimeout.controller.signal,
        });
      } finally {
        clearTimeoutController(uploadTimeout.timeoutId);
      }

      console.log("[admin-import-page] Signed upload response", {
        ok: uploadRes.ok,
        status: uploadRes.status,
      });

      if (!uploadRes.ok) {
        const uploadErrorText = await uploadRes.text().catch(() => "");
        console.log("[admin-import-page] Signed upload failed", {
          status: uploadRes.status,
          errorText: uploadErrorText?.slice?.(0, 500),
        });
        setStatus("PDF upload failed while sending to storage. Please retry.");
        return;
      }

      setStatus("Finalizing import...");

      const finalizeTimeout = createTimeoutController(API_REQUEST_TIMEOUT_MS);
      let finalizeRes;
      let finalizeData;

      try {
        finalizeRes = await fetch("/api/admin-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reportId: initData.reportId,
            userEmail: initData.userEmail,
            safeFileName: initData.safeFileName,
            storagePath: initData.storagePath,
            mimeType: initData.mimeType || "application/pdf",
            sizeBytes: initData.sizeBytes || reportPdf.size,
          }),
          signal: finalizeTimeout.controller.signal,
        });
        finalizeData = await finalizeRes.json().catch(() => ({}));
      } finally {
        clearTimeoutController(finalizeTimeout.timeoutId);
      }

      console.log("[admin-import-page] Finalize response", {
        ok: finalizeRes.ok,
        status: finalizeRes.status,
        data: finalizeData,
      });

      if (finalizeRes.ok) {
        setStatus(`Success! Report assigned to ${normalizedEmail}.`);
        setEmail("");
        setReportPdf(null);
        const fileInput = document.getElementById("admin-import-pdf");
        if (fileInput) {
          fileInput.value = "";
        }
      } else {
        setStatus(finalizeData?.error || "Failed to finalize import.");
      }
    } catch (error) {
      console.log("[admin-import-page] Import failed", error);
      if (error?.name === "AbortError") {
        setStatus("Upload request timed out. Please retry.");
      } else {
        setStatus("Network error while importing. Please try again.");
      }
    } finally {
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
