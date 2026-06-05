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
const REMEMBERED_EMAILS_STORAGE_KEY = "admin-import-remembered-emails";
const REMEMBERED_EMAILS_LIMIT = 10;
const EMAIL_SUGGESTIONS_DATALIST_ID = "admin-import-email-suggestions";
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function parseJsonSafely(rawBody) {
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch (_error) {
    return {};
  }
}

function isNextErrorHtmlBody(rawBody) {
  return rawBody.includes("__next_error__") || rawBody.toLowerCase().startsWith("<!doctype html");
}

function formatAttemptSummary(attempt) {
  const statusPart = attempt.status == null ? "no-status" : `HTTP ${attempt.status}`;
  if (attempt.networkError) {
    return `${attempt.label} (${statusPart}): ${attempt.networkError}`;
  }
  if (attempt.isNextErrorHtml) {
    return `${attempt.label} (${statusPart}): next-error-html`;
  }
  return `${attempt.label} (${statusPart})`;
}

function toNonNegativeInteger(value) {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) return null;
  return Math.floor(parsedValue);
}

function pickFirstNonNegativeInteger(values) {
  for (const candidate of values) {
    const normalized = toNonNegativeInteger(candidate);
    if (normalized != null) return normalized;
  }
  return null;
}

function extractParsePageProgress(data) {
  const parsePages = pickFirstNonNegativeInteger([
    data?.parsePages,
    data?.data?.parsePages,
    data?._parseDiagnostics?.extraction?.pages,
    data?.data?._parseDiagnostics?.extraction?.pages,
    data?.parsed?._parseDiagnostics?.extraction?.pages,
  ]);
  const parseDetectedTotalPages = pickFirstNonNegativeInteger([
    data?.parseDetectedTotalPages,
    data?.data?.parseDetectedTotalPages,
    data?._parseDiagnostics?.extraction?.detectedTotalPages,
    data?.data?._parseDiagnostics?.extraction?.detectedTotalPages,
    data?.parsed?._parseDiagnostics?.extraction?.detectedTotalPages,
  ]);
  const parseTotalPages = pickFirstNonNegativeInteger([
    parseDetectedTotalPages,
    data?.parseMinExpectedPages,
    data?.data?.parseMinExpectedPages,
  ]);
  const isPageCoverageComplete =
    parseDetectedTotalPages > 0 && parsePages != null && parsePages >= parseDetectedTotalPages;

  return {
    parsePages,
    parseTotalPages,
    parseDetectedTotalPages,
    isPageCoverageComplete,
  };
}

function formatParsedPagesText(parsePages, parseTotalPages) {
  const parsePagesLabel = parsePages == null ? "?" : String(parsePages);
  const parseTotalPagesLabel = parseTotalPages == null ? "?" : String(parseTotalPages);
  return `${parsePagesLabel}/${parseTotalPagesLabel}`;
}

function normalizeRememberedEmailCandidate(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!BASIC_EMAIL_PATTERN.test(normalized)) return null;
  return normalized;
}

function buildRememberedEmailList(values) {
  const sourceValues = Array.isArray(values) ? values : [];
  const unique = [];
  const seen = new Set();

  for (const value of sourceValues) {
    const normalized = normalizeRememberedEmailCandidate(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length >= REMEMBERED_EMAILS_LIMIT) break;
  }

  return unique;
}

function areEmailListsEqual(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second)) return false;
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function readRememberedEmailsFromStorage() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(REMEMBERED_EMAILS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const cleaned = buildRememberedEmailList(parsed);
    return cleaned;
  } catch (error) {
    console.log("[admin-import-page] Failed to read remembered emails from localStorage", error);
    return [];
  }
}

function writeRememberedEmailsToStorage(emails) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      REMEMBERED_EMAILS_STORAGE_KEY,
      JSON.stringify(buildRememberedEmailList(emails)),
    );
  } catch (error) {
    console.log("[admin-import-page] Failed to write remembered emails to localStorage", error);
  }
}

export default function AdminImportForm() {
  const [email, setEmail] = useState("");
  const [rememberedEmails, setRememberedEmails] = useState([]);
  const [reportPdf, setReportPdf] = useState(null);
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didUploadSucceed, setDidUploadSucceed] = useState(false);
  const [closeHint, setCloseHint] = useState("");
  const [parseStatus, setParseStatus] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseStartedAtMs, setParseStartedAtMs] = useState(null);
  const [parseElapsedMs, setParseElapsedMs] = useState(0);
  const [lastParseDurationMs, setLastParseDurationMs] = useState(null);
  const [parsePagesCount, setParsePagesCount] = useState(null);
  const [parseTotalPagesCount, setParseTotalPagesCount] = useState(null);
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
    const remembered = readRememberedEmailsFromStorage();
    setRememberedEmails(remembered);
    console.log("[admin-import-page] Loaded remembered email suggestions", {
      rememberedCount: remembered.length,
      rememberedEmails: remembered,
    });
  }, []);

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

  function playCompletionSound(outcome = "unknown") {
    console.log("[admin-import-page] Completion sound requested", { outcome });
    const completionSoundEl = completionSoundRef.current;
    if (!completionSoundEl) {
      console.log("[admin-import-page] Completion sound element missing", { outcome });
      return;
    }

    completionSoundEl.currentTime = 0;
    const playPromise = completionSoundEl.play();

    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          console.log("[admin-import-page] Completion sound played", { outcome });
        })
        .catch((playError) => {
          console.log("[admin-import-page] Completion sound playback failed", { outcome, playError });
        });
      return;
    }

    console.log("[admin-import-page] Completion sound play invoked", { outcome });
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
    setParsePagesCount(null);
    setParseTotalPagesCount(null);
    setParseStatus("Parsing report now...");
    let parseOutcome = "failed";
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

      const setSelectedAttemptResult = ({
        label,
        endpoint,
        nextResponse,
        nextRawBody,
        nextData,
      }) => {
        response = nextResponse;
        rawBody = nextRawBody;
        data = nextData;
        selectedAttemptLabel = label;
        selectedAttemptEndpoint = endpoint;
      };

      const recordAttemptResponse = ({
        label,
        endpoint,
        attemptResponse,
        attemptRawBody,
        attemptData,
        responseLogPrefix,
      }) => {
        const attemptIsNextErrorHtml = isNextErrorHtmlBody(attemptRawBody);
        attemptSummaries.push({
          label,
          endpoint,
          ok: attemptResponse.ok,
          status: attemptResponse.status,
          isNextErrorHtml: attemptIsNextErrorHtml,
        });

        console.log(responseLogPrefix, {
          label,
          endpoint,
          ok: attemptResponse.ok,
          status: attemptResponse.status,
          statusText: attemptResponse.statusText,
          isNextErrorHtml: attemptIsNextErrorHtml,
          data: attemptData,
          rawBodyPreview: attemptRawBody ? attemptRawBody.slice(0, 240) : null,
        });

        setSelectedAttemptResult({
          label,
          endpoint,
          nextResponse: attemptResponse,
          nextRawBody: attemptRawBody,
          nextData: attemptData,
        });

        return attemptIsNextErrorHtml;
      };

      const recordAttemptNetworkFailure = ({
        label,
        endpoint,
        details,
        networkLogPrefix,
      }) => {
        attemptSummaries.push({
          label,
          endpoint,
          ok: false,
          status: null,
          isNextErrorHtml: false,
          networkError: details,
        });

        console.log(networkLogPrefix, {
          label,
          endpoint,
          details,
        });

        setSelectedAttemptResult({
          label,
          endpoint,
          nextResponse: null,
          nextRawBody: "",
          nextData: {},
        });
      };

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
          const attemptData = parseJsonSafely(attemptRawBody);
          const isNextErrorHtml = recordAttemptResponse({
            label,
            endpoint,
            attemptResponse,
            attemptRawBody,
            attemptData,
            responseLogPrefix: "[admin-import-page] Parse attempt response",
          });

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
          recordAttemptNetworkFailure({
            label,
            endpoint,
            details: attemptDetails,
            networkLogPrefix: "[admin-import-page] Parse attempt network failure",
          });
          continue;
        }
      }

      const fallbackSourcePdf = reportPdf instanceof File ? reportPdf : null;

      if (!response?.ok && fallbackSourcePdf) {
        console.log("[admin-import-page] Server parse attempts failed; trying PDF parse fallback", {
          reportId: normalizedReportId,
          sourceFileName: fallbackSourcePdf.name,
          sourceFileSize: fallbackSourcePdf.size,
          sourceFileType: fallbackSourcePdf.type,
        });

        const pdfParseFormData = new FormData();
        pdfParseFormData.append("report", fallbackSourcePdf);
        pdfParseFormData.append("clientId", normalizedReportId);
        pdfParseFormData.append("mode", "admin-inline-safe");

        try {
          const pdfParseResponse = await fetch("/api/pdf/parse", {
            method: "POST",
            body: pdfParseFormData,
          });
          const pdfParseRawBody = await pdfParseResponse.text();
          const pdfParseData = parseJsonSafely(pdfParseRawBody);
          recordAttemptResponse({
            label: "pdf-parse-route",
            endpoint: "/api/pdf/parse",
            attemptResponse: pdfParseResponse,
            attemptRawBody: pdfParseRawBody,
            attemptData: pdfParseData,
            responseLogPrefix: "[admin-import-page] PDF parse fallback response",
          });

          if (pdfParseResponse.ok) {
            const parsedPayload =
              pdfParseData?.data && typeof pdfParseData.data === "object" ? pdfParseData.data : null;

            if (parsedPayload) {
              try {
                const applyParsedResponse = await fetch("/api/admin-import/apply-parsed", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    reportId: normalizedReportId,
                    parsed: parsedPayload,
                    sourceFileName: fallbackSourcePdf.name || parsedPayload?.sourceFile || null,
                  }),
                });
                const applyParsedRawBody = await applyParsedResponse.text();
                const applyParsedData = parseJsonSafely(applyParsedRawBody);
                recordAttemptResponse({
                  label: "admin-import-apply-parsed",
                  endpoint: "/api/admin-import/apply-parsed",
                  attemptResponse: applyParsedResponse,
                  attemptRawBody: applyParsedRawBody,
                  attemptData: applyParsedData,
                  responseLogPrefix: "[admin-import-page] Apply parsed fallback response",
                });
              } catch (applyParsedError) {
                const details = String(
                  applyParsedError?.message || "Unknown apply-parsed fallback network error",
                );
                recordAttemptNetworkFailure({
                  label: "admin-import-apply-parsed",
                  endpoint: "/api/admin-import/apply-parsed",
                  details,
                  networkLogPrefix: "[admin-import-page] Apply parsed fallback network failure",
                });
              }
            } else {
              setSelectedAttemptResult({
                label: "pdf-parse-route",
                endpoint: "/api/pdf/parse",
                nextResponse: pdfParseResponse,
                nextRawBody: pdfParseRawBody,
                nextData: pdfParseData,
              });
            }
          } else {
            setSelectedAttemptResult({
              label: "pdf-parse-route",
              endpoint: "/api/pdf/parse",
              nextResponse: pdfParseResponse,
              nextRawBody: pdfParseRawBody,
              nextData: pdfParseData,
            });
          }
        } catch (pdfParseError) {
          const details = String(pdfParseError?.message || "Unknown pdf parse fallback network error");
          recordAttemptNetworkFailure({
            label: "pdf-parse-route",
            endpoint: "/api/pdf/parse",
            details,
            networkLogPrefix: "[admin-import-page] PDF parse fallback network failure",
          });
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
      const { parsePages, parseTotalPages, isPageCoverageComplete } = extractParsePageProgress(data);
      const parsedPagesText = formatParsedPagesText(parsePages, parseTotalPages);
      setParsePagesCount(parsePages);
      setParseTotalPagesCount(parseTotalPages);
      console.log("[admin-import-page] Parse page coverage", {
        parsePages,
        parseTotalPages,
        isPageCoverageComplete,
      });

      if (response?.ok) {
        const parseStateFromResponse = String(data?.parseStatus || "unknown");
        const parseState = isPageCoverageComplete ? "complete" : parseStateFromResponse;
        const parseIncompleteReason = String(
          data?.parseIncompleteReason ||
            data?.incompleteReason ||
            data?.data?.parseIncompleteReason ||
            data?.data?.incompleteReason ||
            "",
        ).trim();
        const hasNoParsedCoverage = (parsePages == null || parsePages === 0) && (parseTotalPages == null || parseTotalPages === 0);

        if (parseState !== "complete" && hasNoParsedCoverage) {
          parseOutcome = "failed";
          setParseStatus(
            parseIncompleteReason
              ? `Parsing failed in ${durationText}: ${parseIncompleteReason}`
              : `Parsing failed in ${durationText}: no pages were parsed.`,
          );
        } else {
          parseOutcome = parseState === "complete" ? "complete" : "incomplete";
          setParseStatus(`Parsing complete in ${durationText}. Pages parsed: ${parsedPagesText}. Status: ${parseState}.`);
        }
      } else {
        parseOutcome = "failed";
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
        const attemptsText = attemptSummaries.map(formatAttemptSummary).join(" | ");
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
      parseOutcome = "failed";
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
        parseOutcome,
      });
      playCompletionSound(parseOutcome);
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
    setRememberedEmails((previousEmails) => {
      const mergedEmails = buildRememberedEmailList([normalizedEmail, ...previousEmails]);
      if (areEmailListsEqual(previousEmails, mergedEmails)) {
        return previousEmails;
      }
      writeRememberedEmailsToStorage(mergedEmails);
      console.log("[admin-import-page] Remembered email updated from submit", {
        normalizedEmail,
        previousCount: previousEmails.length,
        nextCount: mergedEmails.length,
        mergedEmails,
      });
      return mergedEmails;
    });
    setParseStatus("");
    setIsParsing(false);
    setParseStartedAtMs(null);
    setParseElapsedMs(0);
    setLastParseDurationMs(null);
    setParsePagesCount(null);
    setParseTotalPagesCount(null);
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
        setStatus(`Success! Report assigned to ${normalizedEmail}.`);
        console.log("[admin-import-page] Assignment completed", {
          normalizedEmail,
          finalizeRoute: "primary",
        });
        setDidUploadSucceed(true);
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
            setStatus(`Success! Report assigned to ${normalizedEmail}.`);
            console.log("[admin-import-page] Assignment completed", {
              normalizedEmail,
              finalizeRoute: "lite",
            });
            setDidUploadSucceed(true);
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
            name="email"
            autoComplete="email"
            list={EMAIL_SUGGESTIONS_DATALIST_ID}
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
          <datalist id={EMAIL_SUGGESTIONS_DATALIST_ID} data-testid="admin-import-email-suggestions">
            {rememberedEmails.map((rememberedEmail) => (
              <option key={rememberedEmail} value={rememberedEmail} />
            ))}
          </datalist>

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

      {parseStatus ? (
        <p data-testid="admin-import-parse-status" style={{ marginTop: "8px", fontWeight: 600 }}>
          {parseStatus}
        </p>
      ) : null}

      {parsePagesCount != null || parseTotalPagesCount != null ? (
        <p
          data-testid="admin-import-parse-page-counter"
          style={{ marginTop: "8px", color: "#334155", fontWeight: 600 }}
        >
          {isParsing ? "Parsed pages:" : "Last parsed pages:"}{" "}
          {formatParsedPagesText(parsePagesCount, parseTotalPagesCount)}
          {parseTotalPagesCount > 0 && parsePagesCount >= parseTotalPagesCount ? " (complete)" : ""}
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
