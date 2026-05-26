"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

const API_REQUEST_TIMEOUT_MS = 90_000;
const FINALIZE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const ASSIGN_REPORT_COMPLETE_SOUND_PATH = "/assign-report-complete.wav";

let supabaseBrowserClient;

function getSupabaseBrowserClient() {
  if (!supabaseBrowserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const missingEnvVars = [];
    if (!url) missingEnvVars.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!anonKey) missingEnvVars.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

    if (missingEnvVars.length) {
      throw new Error(
        `Missing public Supabase env vars: ${missingEnvVars.join(
          ", ",
        )}. Add them in Vercel Project Settings > Environment Variables, then redeploy so NEXT_PUBLIC values are included in the browser bundle.`,
      );
    }

    supabaseBrowserClient = createClient(url, anonKey);
  }

  return supabaseBrowserClient;
}

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
  const [didUploadSucceed, setDidUploadSucceed] = useState(false);
  const [closeHint, setCloseHint] = useState("");
  const completionSoundRef = useRef(null);
  const completionSoundUnlockedRef = useRef(false);

  const isFormValid = useMemo(() => {
    return !!email.trim() && !!reportPdf;
  }, [email, reportPdf]);

  const missingPublicEnvVars = useMemo(() => {
    const missing = [];
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return missing;
  }, []);

  useEffect(() => {
    console.log("[admin-import-page] Public env status", {
      hasNextPublicSupabaseUrl: !missingPublicEnvVars.includes("NEXT_PUBLIC_SUPABASE_URL"),
      hasNextPublicSupabaseAnonKey: !missingPublicEnvVars.includes(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ),
      missingPublicEnvVars,
    });
  }, [missingPublicEnvVars]);

  function unlockCompletionSound() {
    if (completionSoundUnlockedRef.current) {
      return;
    }

    const completionSoundEl = completionSoundRef.current;
    if (!completionSoundEl) {
      console.log("[admin-import-page] Completion sound element missing during unlock");
      return;
    }

    completionSoundEl.muted = true;
    completionSoundEl.currentTime = 0;

    const unlockPromise = completionSoundEl.play();
    if (unlockPromise && typeof unlockPromise.then === "function") {
      unlockPromise
        .then(() => {
          completionSoundEl.pause();
          completionSoundEl.currentTime = 0;
          completionSoundEl.muted = false;
          completionSoundUnlockedRef.current = true;
          console.log("[admin-import-page] Completion sound unlocked");
        })
        .catch((unlockError) => {
          completionSoundEl.muted = false;
          console.log("[admin-import-page] Completion sound unlock skipped", unlockError);
        });
      return;
    }

    completionSoundEl.pause();
    completionSoundEl.currentTime = 0;
    completionSoundEl.muted = false;
    completionSoundUnlockedRef.current = true;
    console.log("[admin-import-page] Completion sound unlocked without promise");
  }

  function playCompletionSound() {
    const completionSoundEl = completionSoundRef.current;
    if (!completionSoundEl) {
      console.log("[admin-import-page] Completion sound element missing on success");
      return;
    }

    completionSoundEl.currentTime = 0;
    const playPromise = completionSoundEl.play();

    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          console.log("[admin-import-page] Completion sound played");
        })
        .catch((playError) => {
          console.log("[admin-import-page] Completion sound playback failed", playError);
        });
      return;
    }

    console.log("[admin-import-page] Completion sound play invoked");
  }

  async function handleImport(e) {
    e.preventDefault();
    setDidUploadSucceed(false);
    setCloseHint("");
    if (!isFormValid) {
      setStatus("Please provide a valid email and a PDF report.");
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    setIsSubmitting(true);
    setStatus("Preparing upload...");
    unlockCompletionSound();

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

      setStatus("Uploading PDF to Supabase storage...");

      const supabase = getSupabaseBrowserClient();
      const bucket = initData.bucket;
      const path = initData.storagePath;
      const token = initData.uploadToken;

      if (!bucket || !path || !token) {
        setStatus("Upload token data is incomplete. Please retry.");
        return;
      }

      let uploadTimeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        uploadTimeoutId = setTimeout(
          () => reject(new DOMException("Upload timed out", "AbortError")),
          UPLOAD_REQUEST_TIMEOUT_MS,
        );
      });

      const uploadPromise = supabase.storage.from(bucket).uploadToSignedUrl(path, token, reportPdf);
      const { data: uploadData, error: uploadError } = await Promise.race([
        uploadPromise,
        timeoutPromise,
      ]);
      clearTimeout(uploadTimeoutId);

      if (uploadError) {
        console.log("[admin-import-page] Supabase signed upload failed", {
          uploadError,
          bucket,
          path,
        });
        setStatus(uploadError.message || "PDF upload failed while sending to storage.");
        return;
      }

      console.log("[admin-import-page] Supabase signed upload response", {
        uploadData,
        bucket,
        path,
      });

      setStatus("Finalizing import...");

      const finalizeTimeout = createTimeoutController(FINALIZE_REQUEST_TIMEOUT_MS);
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
        setDidUploadSucceed(true);
        playCompletionSound();
        setEmail("");
        setReportPdf(null);
        const fileInput = document.getElementById("admin-import-pdf");
        if (fileInput) {
          fileInput.value = "";
        }
      } else {
        const finalizedErrorMessage = [finalizeData?.error, finalizeData?.details]
          .filter((value) => typeof value === "string" && value.trim().length > 0)
          .join(": ");
        setStatus(finalizedErrorMessage || "Failed to finalize import.");
      }
    } catch (error) {
      console.log("[admin-import-page] Import failed", error);
      if (error?.name === "AbortError") {
        setStatus("Upload request timed out. Please retry.");
      } else if (String(error?.message || "").includes("Missing public Supabase env vars")) {
        setStatus(error.message);
      } else {
        setStatus("Network error while importing. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCloseWindow() {
    console.log("[admin-import-page] Close window requested");
    setCloseHint("");
    try {
      window.close();
      console.log("[admin-import-page] Primary window.close() attempted");
    } catch (error) {
      console.log("[admin-import-page] Primary window.close() attempt threw", error);
    }

    setTimeout(() => {
      if (window.closed) return;
      try {
        window.open("", "_self");
        window.close();
        console.log("[admin-import-page] Secondary _self window.close() attempted");
      } catch (error) {
        console.log("[admin-import-page] Secondary _self window.close() attempt threw", error);
      }

      setTimeout(() => {
        if (!window.closed) {
          setCloseHint("Your browser blocked automatic closing. Close this tab manually.");
        }
      }, 120);
    }, 120);
  }

  return (
    <div
      data-testid="admin-import-page"
      style={{ maxWidth: "900px", margin: "0 auto", padding: "24px", textAlign: "center" }}
    >
      <h1 data-testid="admin-import-title">Manual Report Importer</h1>
      <audio
        data-testid="admin-import-complete-sound"
        ref={completionSoundRef}
        preload="auto"
        src={ASSIGN_REPORT_COMPLETE_SOUND_PATH}
        aria-hidden="true"
        style={{ display: "none" }}
      />
      <p data-testid="admin-import-description" style={{ color: "#475569", marginTop: "8px" }}>
        Use this hidden page to upload a PDF report and assign it to a specific user email.
      </p>
      {missingPublicEnvVars.length ? (
        <p
          data-testid="admin-import-env-status"
          style={{
            color: "#b91c1c",
            marginTop: "8px",
            fontWeight: 600,
          }}
        >
          {`Env check: Missing ${missingPublicEnvVars.join(
            ", ",
          )}. Add in Vercel and redeploy.`}
        </p>
      ) : null}

      <div
        data-testid="admin-import-card"
        style={{
          border: "1px solid #cbd5e1",
          borderRadius: "14px",
          margin: "20px auto 0",
          padding: "22px",
          maxWidth: "620px",
          background: "#ffffff",
          boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
        }}
      >
        <form
          data-testid="admin-import-form"
          onSubmit={handleImport}
          style={{ display: "grid", gap: "12px", justifyItems: "center" }}
        >
          <input
            data-testid="admin-import-email"
            type="email"
            placeholder="User email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: "100%",
              maxWidth: "420px",
              padding: "10px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: "10px",
              textAlign: "center",
            }}
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
            style={{
              width: "100%",
              maxWidth: "420px",
              padding: "10px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: "10px",
            }}
          />

          <button
            data-testid="admin-import-submit"
            type="submit"
            disabled={!isFormValid || isSubmitting}
            style={{
              width: "100%",
              maxWidth: "420px",
              border: "1px solid #0a66d8",
              borderRadius: "10px",
              background: isSubmitting ? "#93c5fd" : "#0a66d8",
              color: "#ffffff",
              padding: "10px",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {isSubmitting ? "Assigning..." : "Assign Report"}
          </button>
        </form>
      </div>

      <p data-testid="admin-import-status" style={{ marginTop: "14px", fontWeight: 600 }}>
        {status}
      </p>

      {didUploadSucceed ? (
        <div style={{ marginTop: "18px" }}>
          <button
            data-testid="admin-import-close-window"
            type="button"
            onClick={handleCloseWindow}
            style={{
              border: "1px solid #94a3b8",
              borderRadius: "10px",
              background: "#ffffff",
              color: "#0f172a",
              padding: "10px 16px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Close Window
          </button>
          {closeHint ? (
            <p style={{ marginTop: "10px", color: "#334155" }} data-testid="admin-import-close-hint">
              {closeHint}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
