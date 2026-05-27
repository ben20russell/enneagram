"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

const API_REQUEST_TIMEOUT_MS = 90_000;
const FINALIZE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const ASSIGN_REPORT_COMPLETE_SOUND_PATH = "/assign-report-complete.wav";
const DASHBOARD_SANS_FONT_FAMILY =
  "\"Plus Jakarta Sans\", system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif";
const DASHBOARD_DISPLAY_FONT_FAMILY =
  "\"Space Grotesk\", \"Plus Jakarta Sans\", system-ui, sans-serif";

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

function getDurationParts(durationMs) {
  const normalizedDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(normalizedDurationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { minutes, seconds, totalSeconds };
}

function formatDurationText(durationMs) {
  const { minutes, seconds, totalSeconds } = getDurationParts(durationMs);
  const minuteLabel = minutes === 1 ? "minute" : "minutes";
  const secondLabel = seconds === 1 ? "second" : "seconds";
  return `${minutes} ${minuteLabel} ${seconds} ${secondLabel} (${totalSeconds}s)`;
}

export default function AdminImportForm() {
  const [email, setEmail] = useState("");
  const [reportPdf, setReportPdf] = useState(null);
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didUploadSucceed, setDidUploadSucceed] = useState(false);
  const [closeHint, setCloseHint] = useState("");
  const [assignStartedAtMs, setAssignStartedAtMs] = useState(null);
  const [assignElapsedMs, setAssignElapsedMs] = useState(0);
  const [lastAssignDurationMs, setLastAssignDurationMs] = useState(null);
  const [parseStatus, setParseStatus] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseStartedAtMs, setParseStartedAtMs] = useState(null);
  const [parseElapsedMs, setParseElapsedMs] = useState(0);
  const [lastParseDurationMs, setLastParseDurationMs] = useState(null);
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

  const activeDurationMs =
    isSubmitting && Number.isFinite(assignStartedAtMs) ? assignElapsedMs : lastAssignDurationMs;
  const { minutes: durationMinutes, seconds: durationSeconds, totalSeconds: durationTotalSeconds } =
    getDurationParts(activeDurationMs);
  const activeParseDurationMs =
    isParsing && Number.isFinite(parseStartedAtMs) ? parseElapsedMs : lastParseDurationMs;
  const {
    minutes: parseDurationMinutes,
    seconds: parseDurationSeconds,
    totalSeconds: parseDurationTotalSeconds,
  } = getDurationParts(activeParseDurationMs);

  useEffect(() => {
    console.log("[admin-import-page] Public env status", {
      hasNextPublicSupabaseUrl: !missingPublicEnvVars.includes("NEXT_PUBLIC_SUPABASE_URL"),
      hasNextPublicSupabaseAnonKey: !missingPublicEnvVars.includes(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ),
      missingPublicEnvVars,
    });
  }, [missingPublicEnvVars]);

  useEffect(() => {
    if (!isSubmitting || !Number.isFinite(assignStartedAtMs)) {
      return undefined;
    }

    const updateElapsed = () => {
      setAssignElapsedMs(Date.now() - assignStartedAtMs);
    };

    updateElapsed();
    const intervalId = setInterval(updateElapsed, 1000);
    console.log("[admin-import-page] Assignment timer interval started", {
      assignStartedAtMs,
    });

    return () => {
      clearInterval(intervalId);
      console.log("[admin-import-page] Assignment timer interval cleared");
    };
  }, [isSubmitting, assignStartedAtMs]);

  useEffect(() => {
    if (!isParsing || !Number.isFinite(parseStartedAtMs)) {
      return undefined;
    }

    const updateParseElapsed = () => {
      setParseElapsedMs(Date.now() - parseStartedAtMs);
    };

    updateParseElapsed();
    const intervalId = setInterval(updateParseElapsed, 1000);
    console.log("[admin-import-page] Parse timer interval started", {
      parseStartedAtMs,
    });

    return () => {
      clearInterval(intervalId);
      console.log("[admin-import-page] Parse timer interval cleared");
    };
  }, [isParsing, parseStartedAtMs]);

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

  async function parseAssignedReport(reportId) {
    const normalizedReportId = String(reportId || "").trim();
    if (!normalizedReportId) {
      console.log("[admin-import-page] Skipping inline parse because reportId is missing");
      setParseStatus("Parsing skipped: missing report id.");
      return;
    }

    const parseTimerStartedAtMs = Date.now();
    setIsParsing(true);
    setParseStartedAtMs(parseTimerStartedAtMs);
    setParseElapsedMs(0);
    setLastParseDurationMs(null);
    setParseStatus("Parsing report now...");
    console.log("[admin-import-page] Parse timer started", {
      reportId: normalizedReportId,
      parseTimerStartedAtMs,
    });

    try {
      console.log("[admin-import-page] Parsing assigned report inline", { reportId: normalizedReportId });
      const parseAttemptPlans = [
        {
          endpoint: "/api/admin-import",
          label: "admin-import-action-reparse",
          payload: {
            action: "reparse",
            reportId: normalizedReportId,
          },
        },
        {
          endpoint: "/api/admin-import/reparse",
          label: "admin-import-reparse-legacy",
          payload: {
            reportId: normalizedReportId,
          },
        },
      ];

      const attemptSummaries = [];
      let response = null;
      let rawBody = "";
      let data = {};
      let selectedAttemptLabel = null;
      let selectedAttemptEndpoint = null;

      for (const parseAttemptPlan of parseAttemptPlans) {
        const { endpoint, label, payload } = parseAttemptPlan;
        console.log("[admin-import-page] Parse attempt started", {
          label,
          endpoint,
          reportId: normalizedReportId,
        });

        try {
          const attemptResponse = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          const attemptRawBody = await attemptResponse.text();
          let attemptData = {};
          if (attemptRawBody) {
            try {
              attemptData = JSON.parse(attemptRawBody);
            } catch (_error) {
              attemptData = {};
            }
          }
          const isNextErrorHtml =
            attemptRawBody.includes("__next_error__") ||
            attemptRawBody.toLowerCase().startsWith("<!doctype html");
          attemptSummaries.push({
            label,
            endpoint,
            ok: attemptResponse.ok,
            status: attemptResponse.status,
            isNextErrorHtml,
          });

          console.log("[admin-import-page] Parse attempt response", {
            label,
            endpoint,
            ok: attemptResponse.ok,
            status: attemptResponse.status,
            statusText: attemptResponse.statusText,
            isNextErrorHtml,
            data: attemptData,
            rawBodyPreview: attemptRawBody ? attemptRawBody.slice(0, 240) : null,
          });

          response = attemptResponse;
          rawBody = attemptRawBody;
          data = attemptData;
          selectedAttemptLabel = label;
          selectedAttemptEndpoint = endpoint;

          if (attemptResponse.ok) {
            break;
          }

          if (isNextErrorHtml) {
            continue;
          }

          // We got a structured non-HTML parse error; stop retrying and surface details as-is.
          break;
        } catch (attemptError) {
          const attemptDetails = String(attemptError?.message || "Unknown parse attempt network error");
          attemptSummaries.push({
            label,
            endpoint,
            ok: false,
            status: null,
            isNextErrorHtml: false,
            networkError: attemptDetails,
          });
          console.log("[admin-import-page] Parse attempt network failure", {
            label,
            endpoint,
            details: attemptDetails,
          });
          response = null;
          rawBody = "";
          data = {};
          selectedAttemptLabel = label;
          selectedAttemptEndpoint = endpoint;
          continue;
        }
      }

      console.log("[admin-import-page] Inline parse response", {
        ok: response?.ok || false,
        status: response?.status || null,
        statusText: response?.statusText || null,
        data,
        rawBodyPreview: rawBody ? rawBody.slice(0, 240) : null,
        selectedAttemptLabel,
        selectedAttemptEndpoint,
        attemptSummaries,
      });

      const elapsedMs = Date.now() - parseTimerStartedAtMs;
      const durationText = formatDurationText(elapsedMs);
      if (response?.ok) {
        const parseState = String(data?.parseStatus || "unknown");
        setParseStatus(`Parsing complete in ${durationText}. Status: ${parseState}.`);
      } else {
        const parseErrorMessage = [data?.error, data?.details]
          .filter((value) => typeof value === "string" && value.trim().length > 0)
          .join(": ");
        const parseHttpMessage = response
          ? `HTTP ${response.status} ${response.statusText || ""}`.trim()
          : "No HTTP response";
        const isNextErrorHtml =
          rawBody.includes("__next_error__") ||
          rawBody.toLowerCase().startsWith("<!doctype html");
        const parseRawPreview = rawBody ? rawBody.replace(/\s+/g, " ").trim().slice(0, 180) : "";
        const attemptsText = attemptSummaries
          .map((attempt) => {
            const statusPart = attempt.status == null ? "no-status" : `HTTP ${attempt.status}`;
            if (attempt.networkError) {
              return `${attempt.label} (${statusPart}): ${attempt.networkError}`;
            }
            if (attempt.isNextErrorHtml) {
              return `${attempt.label} (${statusPart}): next-error-html`;
            }
            return `${attempt.label} (${statusPart})`;
          })
          .join(" | ");
        setParseStatus(
          parseErrorMessage ||
            (isNextErrorHtml
              ? `Parsing failed in ${durationText} (${parseHttpMessage}): Server runtime error page returned. Attempts: ${attemptsText || "none"}.`
              : parseRawPreview
                ? `Parsing failed in ${durationText} (${parseHttpMessage}): ${parseRawPreview}${attemptsText ? ` | Attempts: ${attemptsText}` : ""}`
                : `Parsing failed in ${durationText} (${parseHttpMessage}).${attemptsText ? ` Attempts: ${attemptsText}` : ""}`),
        );
      }
    } catch (error) {
      console.log("[admin-import-page] Inline parse failed", error);
      const elapsedMs = Date.now() - parseTimerStartedAtMs;
      const durationText = formatDurationText(elapsedMs);
      const details = String(error?.message || "Unknown parse network error");
      setParseStatus(`Parsing failed in ${durationText}: ${details}`);
    } finally {
      const elapsedMs = Date.now() - parseTimerStartedAtMs;
      const durationText = formatDurationText(elapsedMs);
      setParseElapsedMs(elapsedMs);
      setLastParseDurationMs(elapsedMs);
      setParseStartedAtMs(null);
      setIsParsing(false);
      console.log("[admin-import-page] Parse timer stopped", {
        reportId: normalizedReportId,
        elapsedMs,
        durationText,
      });
    }
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
    const importStartedAtMs = Date.now();
    let hasStoppedAssignmentTimer = false;

    const stopAssignmentTimer = (reason) => {
      if (hasStoppedAssignmentTimer) {
        return null;
      }
      const elapsedMs = Date.now() - importStartedAtMs;
      const durationText = formatDurationText(elapsedMs);
      setAssignElapsedMs(elapsedMs);
      setLastAssignDurationMs(elapsedMs);
      setAssignStartedAtMs(null);
      setIsSubmitting(false);
      hasStoppedAssignmentTimer = true;
      console.log("[admin-import-page] Assignment timer stopped", {
        normalizedEmail,
        elapsedMs,
        durationText,
        reason,
      });
      return { elapsedMs, durationText };
    };

    setAssignStartedAtMs(importStartedAtMs);
    setAssignElapsedMs(0);
    setLastAssignDurationMs(null);
    setParseStatus("");
    setIsParsing(false);
    setParseStartedAtMs(null);
    setParseElapsedMs(0);
    setLastParseDurationMs(null);
    setIsSubmitting(true);
    setStatus("Preparing upload...");
    unlockCompletionSound();
    console.log("[admin-import-page] Assignment timer started", {
      importStartedAtMs,
      normalizedEmail,
    });

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
      let finalizeData = {};
      let finalizeRawBody = "";
      const finalizePayload = {
        reportId: initData.reportId,
        userEmail: initData.userEmail,
        safeFileName: initData.safeFileName,
        storagePath: initData.storagePath,
        mimeType: initData.mimeType || "application/pdf",
        sizeBytes: initData.sizeBytes || reportPdf.size,
      };

      try {
        finalizeRes = await fetch("/api/admin-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(finalizePayload),
          signal: finalizeTimeout.controller.signal,
        });
        finalizeRawBody = await finalizeRes.text();
        if (finalizeRawBody) {
          try {
            finalizeData = JSON.parse(finalizeRawBody);
          } catch (_error) {
            finalizeData = {};
          }
        }
      } finally {
        clearTimeoutController(finalizeTimeout.timeoutId);
      }

      console.log("[admin-import-page] Finalize response", {
        ok: finalizeRes.ok,
        status: finalizeRes.status,
        statusText: finalizeRes.statusText,
        data: finalizeData,
        rawBodyPreview: finalizeRawBody ? finalizeRawBody.slice(0, 280) : null,
      });

      if (finalizeRes.ok) {
        const assignmentStop = stopAssignmentTimer("primary-finalize-success");
        const durationText = assignmentStop?.durationText || formatDurationText(Date.now() - importStartedAtMs);
        setStatus(`Success! Report assigned to ${normalizedEmail} in ${durationText}.`);
        console.log("[admin-import-page] Assignment completed", {
          normalizedEmail,
          elapsedMs: assignmentStop?.elapsedMs ?? null,
          durationText,
          finalizeRoute: "primary",
        });
        setDidUploadSucceed(true);
        playCompletionSound();
        await parseAssignedReport(finalizeData?.id || finalizePayload.reportId);
        setEmail("");
        setReportPdf(null);
        const fileInput = document.getElementById("admin-import-pdf");
        if (fileInput) {
          fileInput.value = "";
        }
      } else {
        const isNextErrorHtml =
          finalizeRawBody.includes("__next_error__") ||
          finalizeRawBody.toLowerCase().startsWith("<!doctype html");

        if (isNextErrorHtml) {
          console.log("[admin-import-page] Primary finalize returned Next.js html error page; retrying lite route");
          const liteTimeout = createTimeoutController(FINALIZE_REQUEST_TIMEOUT_MS);
          let liteRes;
          let liteData = {};
          let liteRawBody = "";

          try {
            liteRes = await fetch("/api/admin-import/finalize-lite", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(finalizePayload),
              signal: liteTimeout.controller.signal,
            });
            liteRawBody = await liteRes.text();
            if (liteRawBody) {
              try {
                liteData = JSON.parse(liteRawBody);
              } catch (_error) {
                liteData = {};
              }
            }
          } finally {
            clearTimeoutController(liteTimeout.timeoutId);
          }

          console.log("[admin-import-page] Lite finalize response", {
            ok: liteRes.ok,
            status: liteRes.status,
            statusText: liteRes.statusText,
            data: liteData,
            rawBodyPreview: liteRawBody ? liteRawBody.slice(0, 280) : null,
          });

          if (liteRes.ok) {
            const assignmentStop = stopAssignmentTimer("lite-finalize-success");
            const durationText = assignmentStop?.durationText || formatDurationText(Date.now() - importStartedAtMs);
            setStatus(`Success! Report assigned to ${normalizedEmail} in ${durationText}.`);
            console.log("[admin-import-page] Assignment completed", {
              normalizedEmail,
              elapsedMs: assignmentStop?.elapsedMs ?? null,
              durationText,
              finalizeRoute: "lite",
            });
            setDidUploadSucceed(true);
            playCompletionSound();
            await parseAssignedReport(liteData?.id || finalizePayload.reportId);
            setEmail("");
            setReportPdf(null);
            const fileInput = document.getElementById("admin-import-pdf");
            if (fileInput) {
              fileInput.value = "";
            }
          } else {
            const liteErrorMessage = [liteData?.error, liteData?.details]
              .filter((value) => typeof value === "string" && value.trim().length > 0)
              .join(": ");
            const liteHttpMessage = `HTTP ${liteRes.status} ${liteRes.statusText || ""}`.trim();
            const liteRawPreview = liteRawBody
              ? liteRawBody.replace(/\s+/g, " ").trim().slice(0, 180)
              : "";
            setStatus(
              liteErrorMessage ||
                (liteRawPreview
                  ? `Failed to finalize import (${liteHttpMessage}): ${liteRawPreview}`
                  : `Failed to finalize import (${liteHttpMessage}).`),
            );
          }
        } else {
          const finalizedErrorMessage = [finalizeData?.error, finalizeData?.details]
            .filter((value) => typeof value === "string" && value.trim().length > 0)
            .join(": ");
          const finalizedHttpMessage = `HTTP ${finalizeRes.status} ${finalizeRes.statusText || ""}`.trim();
          const finalizedRawPreview = finalizeRawBody
            ? finalizeRawBody.replace(/\s+/g, " ").trim().slice(0, 180)
            : "";
          setStatus(
            finalizedErrorMessage ||
              (finalizedRawPreview
                ? `Failed to finalize import (${finalizedHttpMessage}): ${finalizedRawPreview}`
                : `Failed to finalize import (${finalizedHttpMessage}).`),
          );
        }
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
      stopAssignmentTimer("handle-import-finally");
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
      style={{
        maxWidth: "900px",
        margin: "0 auto",
        padding: "24px",
        textAlign: "center",
        fontFamily: DASHBOARD_SANS_FONT_FAMILY,
      }}
    >
      <h1 data-testid="admin-import-title" style={{ fontFamily: DASHBOARD_DISPLAY_FONT_FAMILY }}>
        Manual Report Importer
      </h1>
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
            disabled={!isFormValid || isSubmitting || isParsing}
            style={{
              width: "100%",
              maxWidth: "420px",
              border: "1px solid #0a66d8",
              borderRadius: "10px",
              background: isSubmitting || isParsing ? "#93c5fd" : "#0a66d8",
              color: "#ffffff",
              padding: "10px",
              cursor: isSubmitting || isParsing ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {isSubmitting ? "Assigning..." : isParsing ? "Parsing PDF..." : "Assign Report"}
          </button>
        </form>
      </div>

      <p data-testid="admin-import-status" style={{ marginTop: "14px", fontWeight: 600 }}>
        {status}
      </p>

      {activeDurationMs != null ? (
        <p
          data-testid="admin-import-duration-counter"
          style={{ marginTop: "8px", color: "#334155", fontWeight: 600 }}
        >
          {isSubmitting ? "Elapsed assignment time:" : "Last assignment time:"}{" "}
          {durationMinutes} minutes {durationSeconds} seconds ({durationTotalSeconds}s)
        </p>
      ) : null}

      {parseStatus ? (
        <p data-testid="admin-import-parse-status" style={{ marginTop: "8px", fontWeight: 600 }}>
          {parseStatus}
        </p>
      ) : null}

      {activeParseDurationMs != null ? (
        <p
          data-testid="admin-import-parse-duration-counter"
          style={{ marginTop: "8px", color: "#334155", fontWeight: 600 }}
        >
          {isParsing ? "Elapsed parsing time:" : "Last parsing time:"} {parseDurationMinutes} minutes{" "}
          {parseDurationSeconds} seconds ({parseDurationTotalSeconds}s)
        </p>
      ) : null}

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
