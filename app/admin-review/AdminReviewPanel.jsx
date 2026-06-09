"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const TYPE_KEYS = [
  "type1",
  "type2",
  "type3",
  "type4",
  "type5",
  "type6",
  "type7",
  "type8",
  "type9",
];
const INSTINCT_KEYS = ["selfPreservation", "sexual", "social"];
const CENTER_KEYS = ["head", "heart", "body"];
const DASHBOARD_REHYDRATE_STORAGE_KEY = "admin-review:dashboard-rehydrate";
const DASHBOARD_REHYDRATE_CHANNEL = "admin-review-dashboard-sync";

function emptyGroup(keys) {
  return Object.fromEntries(keys.map((key) => [key, ""]));
}

function emptyScores() {
  return {
    typeScores: emptyGroup(TYPE_KEYS),
    instinctScores: emptyGroup(INSTINCT_KEYS),
    centerScores: emptyGroup(CENTER_KEYS),
  };
}

function numberOrNull(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function formatMetric(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  return numeric.toFixed(digits);
}

function resolveHighestScoreKey(values, keys) {
  let winningKey = "";
  let winningValue = Number.NEGATIVE_INFINITY;
  keys.forEach((key) => {
    const currentValue = Number(values?.[key]);
    if (!Number.isFinite(currentValue)) return;
    if (currentValue > winningValue) {
      winningValue = currentValue;
      winningKey = key;
    }
  });
  return winningKey;
}

function emitDashboardRehydrateSignal(signal = {}) {
  if (typeof window === "undefined") return;

  const payload = {
    type: "admin-review-force-resave",
    emittedAt: new Date().toISOString(),
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ...signal,
  };

  try {
    localStorage.setItem(DASHBOARD_REHYDRATE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.log("[admin-review] Failed to save dashboard rehydrate storage signal", {
      details: String(error?.message || error),
    });
  }

  try {
    const channel = new BroadcastChannel(DASHBOARD_REHYDRATE_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  } catch (error) {
    console.log("[admin-review] BroadcastChannel unavailable for dashboard rehydrate signal", {
      details: String(error?.message || error),
    });
  }

  console.log("[admin-review] Emitted dashboard rehydrate signal", payload);
}

export default function AdminReviewPanel() {
  const [queue, setQueue] = useState([]);
  const [reviewedReports, setReviewedReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [mlMetrics, setMlMetrics] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [notes, setNotes] = useState("");
  const [scores, setScores] = useState(emptyScores());
  const [primaryTypePreset, setPrimaryTypePreset] = useState("");
  const [dominantInstinctPreset, setDominantInstinctPreset] = useState("");
  const [dominantCenterPreset, setDominantCenterPreset] = useState("");
  const [isResavingGradedReports, setIsResavingGradedReports] = useState(false);

  async function loadQueue() {
    setIsLoading(true);
    setStatus("Loading review queue...");
    try {
      const res = await fetch("/api/admin-review", { method: "GET", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load review queue");
      }
      const nextQueue = Array.isArray(data?.queue) ? data.queue : [];
      const nextReviewedReports = Array.isArray(data?.reviewedReports) ? data.reviewedReports : [];
      const nextMlMetrics = data?.mlMetrics && typeof data.mlMetrics === "object" ? data.mlMetrics : null;
      const nextSelectableReports = [...nextQueue, ...nextReviewedReports];
      setQueue(nextQueue);
      setReviewedReports(nextReviewedReports);
      setMlMetrics(nextMlMetrics);
      const hasSelectedReport = nextSelectableReports.some((item) => item.id === selectedId);
      if (!hasSelectedReport) {
        setSelectedId(nextQueue[0]?.id || nextReviewedReports[0]?.id || "");
      }
      if (nextQueue.length) {
        setStatus(
          `Loaded ${nextQueue.length} pending report(s) and ${nextReviewedReports.length} previously graded report(s).`,
        );
      } else if (nextReviewedReports.length) {
        setStatus(
          `No reports need review. Loaded ${nextReviewedReports.length} previously graded report(s) for lookup/regrade.`,
        );
      } else {
        setStatus("No reports available.");
      }
      console.log("[admin-review] Queue loaded", {
        pendingCount: nextQueue.length,
        reviewedCount: nextReviewedReports.length,
        labeledReportCount: nextMlMetrics?.labeledReportCount ?? 0,
        parserMae: nextMlMetrics?.parserVsGroundTruth?.meanAbsoluteError ?? null,
        modelMae: nextMlMetrics?.modelVsGroundTruth?.meanAbsoluteError ?? null,
      });
    } catch (error) {
      setStatus(String(error?.message || "Failed to load review queue."));
      console.log("[admin-review] Queue load failed", { details: String(error?.message || error) });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  const selectableReports = useMemo(
    () => [...queue, ...reviewedReports],
    [queue, reviewedReports],
  );

  const selected = useMemo(
    () => selectableReports.find((item) => item.id === selectedId) || null,
    [selectableReports, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    const next = emptyScores();
    TYPE_KEYS.forEach((k) => {
      const value = selected?.typeScores?.[k];
      next.typeScores[k] = value == null ? "" : String(value);
    });
    INSTINCT_KEYS.forEach((k) => {
      const value = selected?.instinctScores?.[k];
      next.instinctScores[k] = value == null ? "" : String(value);
    });
    CENTER_KEYS.forEach((k) => {
      const value = selected?.centerScores?.[k];
      next.centerScores[k] = value == null ? "" : String(value);
    });
    const strongestType = resolveHighestScoreKey(next.typeScores, TYPE_KEYS);
    const strongestInstinct = resolveHighestScoreKey(next.instinctScores, INSTINCT_KEYS);
    const strongestCenter = resolveHighestScoreKey(next.centerScores, CENTER_KEYS);
    setScores(next);
    setPrimaryTypePreset(strongestType ? strongestType.replace("type", "") : "");
    setDominantInstinctPreset(strongestInstinct || "");
    setDominantCenterPreset(strongestCenter || "");
    setNotes("");
  }, [selected?.id]);

  function setScore(group, key, value) {
    setScores((prev) => ({
      ...prev,
      [group]: {
        ...(prev[group] || {}),
        [key]: value,
      },
    }));
  }

  function applyPrimaryTypePreset() {
    if (!primaryTypePreset) {
      setStatus("Pick a primary type before applying preset values.");
      return;
    }

    const targetKey = `type${primaryTypePreset}`;
    setScores((prev) => ({
      ...prev,
      typeScores: Object.fromEntries(
        TYPE_KEYS.map((key) => [key, key === targetKey ? "100" : "0"]),
      ),
    }));
    setStatus(`Applied primary type preset: Type ${primaryTypePreset} = 100, others = 0.`);
    console.log("[admin-review] Applied primary type preset", { selectedId, primaryTypePreset });
  }

  function applyDominantPreset(group, dominantKey, keys) {
    if (!dominantKey) {
      setStatus("Pick a dominant option before applying preset values.");
      return;
    }

    setScores((prev) => ({
      ...prev,
      [group]: Object.fromEntries(
        keys.map((key) => [key, key === dominantKey ? "100" : "0"]),
      ),
    }));
    setStatus(`Applied dominant preset for ${group}.`);
    console.log("[admin-review] Applied dominant preset", { selectedId, group, dominantKey });
  }

  async function submitReview() {
    if (!selected) {
      setStatus("Select a report first.");
      return;
    }
    setStatus(`Saving review for ${selected.id}...`);
    const payload = {
      reportId: selected.id,
      notes,
      primaryType: primaryTypePreset ? Number(primaryTypePreset) : null,
      scores: {
        typeScores: Object.fromEntries(
          Object.entries(scores.typeScores).map(([k, v]) => [k, numberOrNull(v)]),
        ),
        instinctScores: Object.fromEntries(
          Object.entries(scores.instinctScores).map(([k, v]) => [k, numberOrNull(v)]),
        ),
        centerScores: Object.fromEntries(
          Object.entries(scores.centerScores).map(([k, v]) => [k, numberOrNull(v)]),
        ),
      },
    };

    try {
      const res = await fetch("/api/admin-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save review");
      }
      setStatus(
        `Saved review. Status: ${data?.reviewStatus || "updated"} · Type: ${data?.enneagramType || "n/a"}`,
      );
      console.log("[admin-review] Saved review", data);
      await loadQueue();
    } catch (error) {
      setStatus(String(error?.message || "Failed to save review"));
      console.log("[admin-review] Save failed", { details: String(error?.message || error) });
    }
  }

  async function handleForceResaveGradedReports() {
    setIsResavingGradedReports(true);
    setStatus("Force re-saving graded reports...");
    try {
      const res = await fetch("/api/admin-review/resave-graded", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxRows: 5000, pageSize: 500 }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to re-save graded reports");
      }
      setStatus(
        `Re-save complete. Scanned ${data?.scannedCount ?? 0}, graded ${data?.gradedCount ?? 0}, updated ${data?.updatedCount ?? 0}, skipped ${data?.skippedCount ?? 0}, failed ${data?.failedCount ?? 0}.`,
      );
      emitDashboardRehydrateSignal({
        reason: "force-resave-graded",
        scannedCount: data?.scannedCount ?? 0,
        gradedCount: data?.gradedCount ?? 0,
        updatedCount: data?.updatedCount ?? 0,
        skippedCount: data?.skippedCount ?? 0,
        failedCount: data?.failedCount ?? 0,
      });
      console.log("[admin-review] Force re-save completed", data);
      await loadQueue();
    } catch (error) {
      setStatus(String(error?.message || "Failed to re-save graded reports"));
      console.log("[admin-review] Force re-save failed", { details: String(error?.message || error) });
    } finally {
      setIsResavingGradedReports(false);
    }
  }

  return (
    <main data-testid="admin-review-page" style={{ padding: "20px", maxWidth: "980px", margin: "0 auto" }}>
      <section
        data-testid="admin-review-header-row"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        <h1 data-testid="admin-review-title" style={{ margin: 0 }}>Admin Review Queue</h1>
        <Link
          data-testid="admin-review-import-link-button"
          href="/admin-import"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "180px",
            border: "1px solid #0a66d8",
            borderRadius: "8px",
            background: "#ffffff",
            color: "#0a66d8",
            fontWeight: 600,
            textDecoration: "none",
            padding: "8px 14px",
            flexShrink: 0,
          }}
        >
          Open Admin Import
        </Link>
      </section>
      <p data-testid="admin-review-subtitle" style={{ color: "#475569" }}>
        Confirm uncertain chart numerics before reports are marked ready.
      </p>

      <div data-testid="admin-review-status" style={{ marginTop: "8px", fontWeight: 600 }}>{status}</div>
      <section
        data-testid="admin-review-ml-metrics"
        style={{ marginTop: "12px", padding: "12px", border: "1px solid #cbd5e1", borderRadius: "8px", background: "#f8fafc" }}
      >
        <h2 data-testid="admin-review-ml-metrics-title" style={{ margin: 0, fontSize: "16px" }}>
          ML Feedback Metrics
        </h2>
        <p data-testid="admin-review-ml-metrics-labeled" style={{ margin: "6px 0 0", color: "#334155" }}>
          Labeled reports: {mlMetrics?.labeledReportCount ?? 0}
        </p>
        <p data-testid="admin-review-ml-metrics-parser-mae" style={{ margin: "6px 0 0", color: "#334155" }}>
          Parser MAE: {formatMetric(mlMetrics?.parserVsGroundTruth?.meanAbsoluteError)}
        </p>
        <p data-testid="admin-review-ml-metrics-model-mae" style={{ margin: "6px 0 0", color: "#334155" }}>
          Model MAE: {formatMetric(mlMetrics?.modelVsGroundTruth?.meanAbsoluteError)}
        </p>
        <p data-testid="admin-review-ml-metrics-improvement" style={{ margin: "6px 0 0", color: "#334155" }}>
          MAE improvement: {formatMetric(mlMetrics?.absoluteMaeImprovement)} ({formatMetric(mlMetrics?.relativeMaeImprovementPercent)}%)
        </p>
      </section>

      <section data-testid="admin-review-controls" style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <button data-testid="admin-review-refresh" onClick={loadQueue} disabled={isLoading} style={{ width: "160px" }}>
            {isLoading ? "Refreshing..." : "Refresh Queue"}
          </button>
          <button
            data-testid="admin-review-force-resave-graded"
            onClick={handleForceResaveGradedReports}
            disabled={isResavingGradedReports || isLoading}
            style={{ width: "260px" }}
          >
            {isResavingGradedReports ? "Re-saving..." : "Force Re-save Graded Reports"}
          </button>
        </div>
        <select
          data-testid="admin-review-select"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          disabled={!selectableReports.length}
        >
          <option value="">Select a report</option>
          {queue.length ? (
            <optgroup label="Pending reports">
              {queue.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.userEmail} · {item.fileName || "report"} · {item.id.slice(0, 8)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {reviewedReports.length ? (
            <optgroup label="Previously graded reports">
              {reviewedReports.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.userEmail} · {item.fileName || "report"} · {item.id.slice(0, 8)} · {item.reviewStatus}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </section>

      {selected ? (
        <section data-testid="admin-review-form" style={{ marginTop: "20px", display: "grid", gap: "14px" }}>
          <p data-testid="admin-review-pending" style={{ margin: 0 }}>
            Pending fields: {(selected.pendingFields || []).join(", ") || "none"}
          </p>

          <section
            data-testid="admin-review-guidance"
            style={{ padding: "12px", border: "1px solid #cbd5e1", borderRadius: "8px", background: "#f8fafc", display: "grid", gap: "6px" }}
          >
            <strong>Quick Labeling Rules</strong>
            <span>Primary type: set one type to 100 and all others to 0.</span>
            <span>Dominant instinct: set one to 100 and the others to 0.</span>
            <span>Dominant center: set one to 100 and the others to 0.</span>
            <span>Use whole numbers in the 0-100 range.</span>
          </section>

          <section data-testid="admin-review-preset-controls" style={{ display: "grid", gap: "10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", alignItems: "end" }}>
              <label style={{ display: "grid", gap: "4px" }}>
                <span>Primary Type Preset</span>
                <select
                  data-testid="admin-review-primary-type-select"
                  value={primaryTypePreset}
                  onChange={(event) => setPrimaryTypePreset(event.target.value)}
                >
                  <option value="">Select primary type</option>
                  {TYPE_KEYS.map((typeKey) => {
                    const typeLabel = typeKey.replace("type", "");
                    return (
                      <option key={typeKey} value={typeLabel}>
                        Type {typeLabel}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button data-testid="admin-review-primary-type-apply" onClick={applyPrimaryTypePreset}>
                Apply Type Preset
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", alignItems: "end" }}>
              <label style={{ display: "grid", gap: "4px" }}>
                <span>Dominant Instinct Preset</span>
                <select
                  data-testid="admin-review-dominant-instinct-select"
                  value={dominantInstinctPreset}
                  onChange={(event) => setDominantInstinctPreset(event.target.value)}
                >
                  <option value="">Select dominant instinct</option>
                  {INSTINCT_KEYS.map((instinctKey) => (
                    <option key={instinctKey} value={instinctKey}>
                      {instinctKey}
                    </option>
                  ))}
                </select>
              </label>
              <button
                data-testid="admin-review-dominant-instinct-apply"
                onClick={() => applyDominantPreset("instinctScores", dominantInstinctPreset, INSTINCT_KEYS)}
              >
                Apply Instinct Preset
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", alignItems: "end" }}>
              <label style={{ display: "grid", gap: "4px" }}>
                <span>Dominant Center Preset</span>
                <select
                  data-testid="admin-review-dominant-center-select"
                  value={dominantCenterPreset}
                  onChange={(event) => setDominantCenterPreset(event.target.value)}
                >
                  <option value="">Select dominant center</option>
                  {CENTER_KEYS.map((centerKey) => (
                    <option key={centerKey} value={centerKey}>
                      {centerKey}
                    </option>
                  ))}
                </select>
              </label>
              <button
                data-testid="admin-review-dominant-center-apply"
                onClick={() => applyDominantPreset("centerScores", dominantCenterPreset, CENTER_KEYS)}
              >
                Apply Center Preset
              </button>
            </div>
          </section>

          <div data-testid="admin-review-types" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
            {TYPE_KEYS.map((key) => (
              <label key={key} style={{ display: "grid", gap: "4px" }}>
                <span>{key}</span>
                <input
                  data-testid={`admin-review-${key}`}
                  value={scores.typeScores[key]}
                  onChange={(event) => setScore("typeScores", key, event.target.value)}
                  inputMode="numeric"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="0-100"
                />
              </label>
            ))}
          </div>

          <div data-testid="admin-review-instincts" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
            {INSTINCT_KEYS.map((key) => (
              <label key={key} style={{ display: "grid", gap: "4px" }}>
                <span>{key}</span>
                <input
                  data-testid={`admin-review-${key}`}
                  value={scores.instinctScores[key]}
                  onChange={(event) => setScore("instinctScores", key, event.target.value)}
                  inputMode="numeric"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="0-100"
                />
              </label>
            ))}
          </div>

          <div data-testid="admin-review-centers" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
            {CENTER_KEYS.map((key) => (
              <label key={key} style={{ display: "grid", gap: "4px" }}>
                <span>{key}</span>
                <input
                  data-testid={`admin-review-${key}`}
                  value={scores.centerScores[key]}
                  onChange={(event) => setScore("centerScores", key, event.target.value)}
                  inputMode="numeric"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  placeholder="0-100"
                />
              </label>
            ))}
          </div>

          <label style={{ display: "grid", gap: "4px" }}>
            <span>Review notes</span>
            <textarea
              data-testid="admin-review-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
            />
          </label>

          <button data-testid="admin-review-submit" onClick={submitReview}>
            Save Review
          </button>
        </section>
      ) : null}
    </main>
  );
}
