"use client";

import { useEffect, useMemo, useState } from "react";

function emptyScores() {
  return {
    typeScores: {
      type1: "",
      type2: "",
      type3: "",
      type4: "",
      type5: "",
      type6: "",
      type7: "",
      type8: "",
      type9: "",
    },
    instinctScores: {
      selfPreservation: "",
      sexual: "",
      social: "",
    },
    centerScores: {
      head: "",
      heart: "",
      body: "",
    },
  };
}

function numberOrNull(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export default function AdminReviewPanel() {
  const [queue, setQueue] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [notes, setNotes] = useState("");
  const [scores, setScores] = useState(emptyScores());

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
      setQueue(nextQueue);
      if (!selectedId && nextQueue.length) {
        setSelectedId(nextQueue[0].id);
      }
      setStatus(nextQueue.length ? `Loaded ${nextQueue.length} pending report(s).` : "No reports need review.");
      console.log("[admin-review] Queue loaded", { count: nextQueue.length });
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

  const selected = useMemo(
    () => queue.find((item) => item.id === selectedId) || null,
    [queue, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    const next = emptyScores();
    Object.keys(next.typeScores).forEach((k) => {
      const value = selected?.typeScores?.[k];
      next.typeScores[k] = value == null ? "" : String(value);
    });
    Object.keys(next.instinctScores).forEach((k) => {
      const value = selected?.instinctScores?.[k];
      next.instinctScores[k] = value == null ? "" : String(value);
    });
    Object.keys(next.centerScores).forEach((k) => {
      const value = selected?.centerScores?.[k];
      next.centerScores[k] = value == null ? "" : String(value);
    });
    setScores(next);
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

  async function submitReview() {
    if (!selected) {
      setStatus("Select a report first.");
      return;
    }
    setStatus(`Saving review for ${selected.id}...`);
    const payload = {
      reportId: selected.id,
      notes,
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
      setStatus(`Saved review. Status: ${data?.reviewStatus || "updated"}`);
      console.log("[admin-review] Saved review", data);
      await loadQueue();
    } catch (error) {
      setStatus(String(error?.message || "Failed to save review"));
      console.log("[admin-review] Save failed", { details: String(error?.message || error) });
    }
  }

  return (
    <main data-testid="admin-review-page" style={{ padding: "20px", maxWidth: "980px", margin: "0 auto" }}>
      <h1 data-testid="admin-review-title" style={{ margin: 0 }}>Admin Review Queue</h1>
      <p data-testid="admin-review-subtitle" style={{ color: "#475569" }}>
        Confirm uncertain chart numerics before reports are marked ready.
      </p>

      <div data-testid="admin-review-status" style={{ marginTop: "8px", fontWeight: 600 }}>{status}</div>

      <section data-testid="admin-review-controls" style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
        <button data-testid="admin-review-refresh" onClick={loadQueue} disabled={isLoading} style={{ width: "160px" }}>
          {isLoading ? "Refreshing..." : "Refresh Queue"}
        </button>
        <select
          data-testid="admin-review-select"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          disabled={!queue.length}
        >
          <option value="">Select a report</option>
          {queue.map((item) => (
            <option key={item.id} value={item.id}>
              {item.userEmail} · {item.fileName || "report"} · {item.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </section>

      {selected ? (
        <section data-testid="admin-review-form" style={{ marginTop: "20px", display: "grid", gap: "14px" }}>
          <p data-testid="admin-review-pending" style={{ margin: 0 }}>
            Pending fields: {(selected.pendingFields || []).join(", ") || "none"}
          </p>

          <div data-testid="admin-review-types" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
            {Object.keys(scores.typeScores).map((key) => (
              <label key={key} style={{ display: "grid", gap: "4px" }}>
                <span>{key}</span>
                <input
                  data-testid={`admin-review-${key}`}
                  value={scores.typeScores[key]}
                  onChange={(event) => setScore("typeScores", key, event.target.value)}
                  inputMode="numeric"
                />
              </label>
            ))}
          </div>

          <div data-testid="admin-review-instincts" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
            {Object.keys(scores.instinctScores).map((key) => (
              <label key={key} style={{ display: "grid", gap: "4px" }}>
                <span>{key}</span>
                <input
                  data-testid={`admin-review-${key}`}
                  value={scores.instinctScores[key]}
                  onChange={(event) => setScore("instinctScores", key, event.target.value)}
                  inputMode="numeric"
                />
              </label>
            ))}
          </div>

          <div data-testid="admin-review-centers" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
            {Object.keys(scores.centerScores).map((key) => (
              <label key={key} style={{ display: "grid", gap: "4px" }}>
                <span>{key}</span>
                <input
                  data-testid={`admin-review-${key}`}
                  value={scores.centerScores[key]}
                  onChange={(event) => setScore("centerScores", key, event.target.value)}
                  inputMode="numeric"
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
