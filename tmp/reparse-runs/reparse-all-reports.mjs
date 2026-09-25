#!/usr/bin/env node
// One-off operator utility. Staging makes read/AI calls, but NEVER database writes.
// --help, --self-test and --verify-stage are entirely offline.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../lib/supabaseAdmin.js";
import { parsePdf } from "../../lib/parsePdf.js";
import { sanitizePdfForParsing, resolvePdfSanitizeFormFieldMode } from "../../lib/pdfSanitize.js";
import { buildMlExtractionLearningContextFromReportRows } from "../../lib/mlExtractionLearning.js";
import { applyMlScoreLearningToParsedProfile } from "../../lib/mlScoreLearning.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GROUPS = ["typeScores", "instinctScores", "centerScores"];
const RETRY_MS = [500, 1000, 2000, 4000, 8000];
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const optional = (value) => String(value ?? "").trim() || null;
const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
  return value;
}
const sha = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
const fingerprint = (value) => sha(canonical(value));
const same = (left, right) => canonical(left) === canonical(right);
const fileKey = (id) => sha(String(id)).slice(0, 24);
const typeNumber = (value) => {
  const match = String(value ?? "").match(/[1-9]/);
  return match ? Number(match[0]) : null;
};
function instinct(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "sx" || /sexual|one[- ]on[- ]one/.test(text)) return "sx";
  if (text === "so" || text.includes("social")) return "so";
  if (text === "sp" || /self[- ]preservation/.test(text)) return "sp";
  return null;
}
function integration(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return ({ high: "High", moderate: "Moderate", medium: "Moderate", low: "Low" })[text] || optional(value);
}
function results(row) {
  if (typeof row?.results_data === "string") return object(JSON.parse(row.results_data));
  return object(row?.results_data);
}
function storedPdf(row) {
  const metadata = { ...object(results(row).file), ...object(row.report_pdf) };
  const storagePath = optional(metadata.storagePath);
  if (!storagePath) return null;
  const fileName = optional(metadata.fileName) || storagePath.split("/").pop();
  const mime = String(metadata.mimeType || metadata.contentType || "").toLowerCase();
  if (!/\.pdf$/i.test(fileName) && !/\.pdf$/i.test(storagePath) && mime !== "application/pdf") return null;
  return { bucket: optional(metadata.bucket) || getSupabaseStorageBucket(), storagePath, fileName };
}
function safeguard(row) {
  const data = results(row);
  const prior = object(data.parsedProfile);
  const review = object(data.review?.coreIdentity);
  const verified = object(data.ingestion?.parseDiagnostics?.verification?.resolvedFields);
  const truth = object(data.ml?.feedback?.groundTruthIdentity);
  return {
    enabled: true, lockOnMismatch: true, source: "one-off:reparse-all-reports",
    priorVerified: {
      primaryType: typeNumber(truth.primaryType ?? review.primaryType ?? verified.primaryType ?? prior.primaryType ?? row.enneagram_type),
      typeName: optional(truth.typeName ?? review.typeName ?? verified.typeName ?? prior.typeName),
      instinctualVariant: instinct(truth.instinctualVariant ?? review.instinctualVariant ?? verified.instinctualVariant ?? prior.instinctualVariant),
      integrationLevel: integration(truth.integrationLevel ?? review.integrationLevel ?? verified.integrationLevel ?? prior.integrationLevel),
    },
  };
}
function preserveReviewedScores(profile, row) {
  const next = structuredClone(profile);
  const data = results(row);
  const truth = object(data.ml?.feedback?.groundTruthScores);
  const explicitlyReviewed = Boolean(data.review?.reviewedAt || data.review?.reviewedBy || data.review?.status === "approved" || data.ml?.feedback?.labelSource === "admin-review");
  for (const group of GROUPS) {
    const protectedScores = { ...(explicitlyReviewed ? object(data.parsedProfile?.[group]) : {}), ...object(truth[group]) };
    next[group] = { ...object(next[group]) };
    for (const [key, value] of Object.entries(protectedScores)) {
      if (value != null && Number.isFinite(Number(value))) next[group][key] = Number(value);
    }
  }
  return next;
}
function proposedUpdate(row, profile, ml, sanitization, pdf, runId) {
  const previous = results(row);
  const now = new Date().toISOString();
  const next = structuredClone(profile);
  next._parseDiagnostics = { ...object(next._parseDiagnostics), sanitization };
  const review = Object.keys(object(previous.review)).length ? previous.review : { status: "auto_approved", updatedAt: now };
  return {
    enneagram_type: typeNumber(next.primaryType),
    results_data: {
      ...previous,
      parsedProfile: next,
      review,
      ml: { ...object(previous.ml), ...object(ml), ...(previous.ml?.feedback !== undefined ? { feedback: previous.ml.feedback } : {}) },
      ingestion: {
        ...object(previous.ingestion), status: review.status === "needs_review" ? "incomplete" : "ready",
        ingestedAt: now, reportId: row.id, parseDiagnostics: next._parseDiagnostics,
        parser: { provider: "azure-openai", model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || null },
        reparsePipeline: { source: "one-off:reparse-all-reports", runId, stagedAt: now, parseState: next._parseState, sourcePdfSha256: pdf.sha256, actualPages: pdf.actualPages },
      },
      dashboardContext: {
        ...object(previous.dashboardContext), detectedType: String(next.primaryType), detectedTypeSource: "one-off:verified-reparse",
        sourceFileName: pdf.fileName, clientName: next.clientName || previous.dashboardContext?.clientName || null,
        basicFear: next.coreFear || null, basicDesire: next.coreDesire || null, passion: next.passion || null,
        integrationLevel: next.integrationLevel || null, integration: next.integrationLevel || null,
        instinct: next.instinctualVariant || null, instinctCode: next.instinctualVariant || null, reportSummary: next.reportSummary || null,
      },
      extractedContent: {
        ...object(previous.extractedContent), documentSummary: next.reportContent?.documentSummary || null,
        pages: next.reportContent?.pages || [], sections: next.reportContent?.sections || [],
        extractedAt: now, parserVersion: next._parseDiagnostics?.parserVersion || null,
      },
    },
  };
}
function validateCandidate(row, candidate) {
  const issues = [];
  if (candidate.reportId !== row.id || candidate.baselineSha256 !== fingerprint(row)) issues.push("baseline_or_report_id_changed");
  const data = object(candidate.update?.results_data);
  const profile = object(data.parsedProfile);
  const diagnostics = object(profile._parseDiagnostics);
  const verification = object(diagnostics.verification);
  const pages = Array.isArray(profile.reportContent?.pages) ? profile.reportContent.pages : [];
  const actual = candidate.pdf?.actualPages;
  if (!Number.isInteger(actual) || actual < 1) issues.push("invalid_actual_pdf_page_count");
  if (profile._parseState !== "complete" || profile.parseState !== "complete" || diagnostics.isComplete !== true) issues.push("parse_not_complete");
  if (!verification.available || verification.isVerifiedForHydration !== true) issues.push("python_cross_check_unavailable_or_unverified");
  const mismatches = Object.entries(object(verification.checks)).filter(([, check]) => check?.status === "mismatch").map(([key]) => key);
  if (Number(verification.mismatchCount || 0) > 0 || Number(verification.criticalMismatchCount || 0) > 0 || mismatches.length || (verification.mismatchKeys || []).length) issues.push(`cross_check_mismatch:${mismatches.join(",")}`);
  if (pages.length !== actual || diagnostics.extraction?.pages !== actual || diagnostics.extraction?.detectedTotalPages !== actual) issues.push("actual_page_coverage_mismatch");
  if (Number(verification.python?.pageCount) !== actual) issues.push("python_page_count_mismatch");
  const numbers = pages.map((page, index) => Number(page.pageNumber ?? page.page ?? index + 1));
  if (new Set(numbers).size !== actual || numbers.some((number, index) => number !== index + 1)) issues.push("missing_duplicate_or_unordered_pages");
  if (pages.some((page) => !optional(page.extractedText || page.text))) issues.push("empty_extracted_page_requires_review");
  const previous = results(row);
  const previousPageCount = Math.max(previous.parsedProfile?.reportContent?.pages?.length || 0, previous.extractedContent?.pages?.length || 0);
  if (pages.length < previousPageCount) issues.push("page_coverage_loss");
  if (!same(data.extractedContent?.pages, profile.reportContent?.pages)) issues.push("extracted_content_out_of_sync");
  if (!typeNumber(profile.primaryType) || typeNumber(profile.primaryType) !== typeNumber(candidate.update?.enneagram_type)) issues.push("missing_or_inconsistent_primary_type");
  const prior = safeguard(row).priorVerified;
  for (const [key, normalize] of [["primaryType", typeNumber], ["instinctualVariant", instinct], ["integrationLevel", integration]]) {
    if (prior[key] != null && normalize(profile[key]) !== normalize(prior[key])) issues.push(`prior_identity_drift:${key}`);
    const resolved = verification.resolvedFields?.[key];
    if (resolved != null && normalize(profile[key]) !== normalize(resolved)) issues.push(`resolved_identity_drift:${key}`);
  }
  if (previous.review !== undefined && !same(previous.review, data.review)) issues.push("review_changed");
  if (previous.ml?.feedback !== undefined && !same(previous.ml.feedback, data.ml?.feedback)) issues.push("ml_feedback_changed");
  const protectedProfile = preserveReviewedScores(profile, row);
  for (const group of GROUPS) {
    if (!same(protectedProfile[group], profile[group])) issues.push(`reviewed_scores_changed:${group}`);
    const beforeCount = Object.values(object(previous.parsedProfile?.[group])).filter((value) => value != null).length;
    const afterCount = Object.values(object(profile[group])).filter((value) => value != null).length;
    if (afterCount < beforeCount) issues.push(`score_coverage_loss:${group}`);
  }
  return { valid: issues.length === 0, issues, actualPages: actual, extractedPages: pages.length, primaryType: profile.primaryType, instinct: profile.instinctualVariant, scoreCoverage: Object.fromEntries(GROUPS.map((group) => [group, Object.values(object(profile[group])).filter((value) => value != null).length])) };
}
function transient(error) {
  const status = Number(error?.status || error?.statusCode);
  const description = `${error?.message || error} ${error?.details || ""} ${error?.cause?.code || ""}`;
  return [408, 409, 429].includes(status) || status >= 500 && status <= 599 || /fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|stream disconnected|response\.failed|\b(?:408|409|429|5\d\d)\b/i.test(description);
}
async function retry(label, operation) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); } catch (error) {
      if (attempt >= RETRY_MS.length || !transient(error)) throw error;
      const delay = Math.round(RETRY_MS[attempt] * (0.8 + Math.random() * 0.4));
      console.log("[reparse-all] retry", { label, retry: attempt + 1, maxRetries: RETRY_MS.length, delayMs: delay, errorClass: error.name || "Error", status: error.status || null });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
async function checked(label, operation) {
  return retry(label, async () => {
    const response = await operation();
    if (response.error) throw Object.assign(new Error(`${label}: ${response.error.message}`), { status: response.status, details: response.error.details });
    return response.data;
  });
}
async function json(file, value) { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }
async function readJson(file) { return JSON.parse(await fs.readFile(file, "utf8")); }
async function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    let text;
    try { text = await fs.readFile(path.join(ROOT, name), "utf8"); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    for (const line of text.split(/\r?\n/)) {
      const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }
}
async function inventory(supabase, table) {
  const rows = [];
  let last = null;
  while (true) {
    const page = await checked("inventory", () => {
      let query = supabase.from(table).select("*").order("id", { ascending: true }).limit(500);
      if (last != null) query = query.gt("id", last);
      return query;
    });
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    const next = page.at(-1).id;
    if (!next || next === last) throw new Error("Inventory pagination failed to advance");
    last = next;
    if (page.length < 500) break;
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Duplicate report IDs in inventory");
  return rows;
}
// ML helper gets one immutable pre-run inventory, avoiding feedback from rows saved earlier in the run.
function snapshotClient(rows) {
  return { from() { return { select() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: rows, error: null }); } }; } };
}
async function stage(options) {
  await loadEnv();
  const supabase = getSupabaseAdmin();
  const table = process.env.SUPABASE_REPORTS_TABLE || "reports";
  const runId = `all-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const directory = path.resolve(options.directory || path.join(ROOT, "tmp/reparse-runs", runId));
  await fs.mkdir(directory, { mode: 0o700 }); // refuse overwriting an earlier run
  for (const child of ["pdfs", "candidates", "parsed"]) await fs.mkdir(path.join(directory, child), { mode: 0o700 });
  const rows = await inventory(supabase, table);
  const targetRows = rows.filter((row) => storedPdf(row));
  await json(path.join(directory, "before.json"), rows);
  const manifest = {
    version: 1, runId, createdAt: new Date().toISOString(), mode: "stage", table,
    databaseSha256: sha(process.env.SUPABASE_URL || ""), baselineSha256: fingerprint(rows),
    scannedCount: rows.length, pdfCount: targetRows.length, workers: options.workers,
    excludedRows: rows.filter((row) => !storedPdf(row)).map((row) => ({ id: row.id, reason: "no_recognizable_stored_pdf_reference" })),
    stageComplete: false, entries: [],
    note: "Staging does not update Supabase. Browser hydration and UI switch verification remain required after apply.",
  };
  await json(path.join(directory, "manifest.json"), manifest);
  console.log("[reparse-all] snapshot saved", { directory, scanned: rows.length, pdfs: targetRows.length });
  let cursor = 0;
  await Promise.all(Array.from({ length: options.workers }, async () => {
    while (cursor < targetRows.length) {
      const row = targetRows[cursor++];
      const key = fileKey(row.id);
      const reference = storedPdf(row);
      try {
        console.log("[reparse-all] parsing", { reportId: row.id, fileName: reference.fileName });
        const blob = await checked(`download:${row.id}`, () => supabase.storage.from(reference.bucket).download(reference.storagePath));
        const bytes = Buffer.from(await blob.arrayBuffer());
        const actualPages = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
        if (actualPages < 1) throw new Error("PDF has no pages");
        await fs.writeFile(path.join(directory, "pdfs", `${key}.pdf`), bytes, { mode: 0o600 });
        const pdf = { ...reference, actualPages, sha256: sha(bytes), backupFile: `pdfs/${key}.pdf` };
        const sanitized = await sanitizePdfForParsing(bytes, { source: "one-off:reparse-all-reports", formFieldMode: resolvePdfSanitizeFormFieldMode(process.env.PDF_SANITIZE_FORM_FIELDS_MODE), removeAnnotations: true, stripNonContentExtras: true, stripMetadata: true });
        if ((await PDFDocument.load(sanitized.buffer, { ignoreEncryption: true })).getPageCount() !== actualPages) throw new Error("Sanitization changed PDF page count");
        const parsed = await retry(`parse:${row.id}`, async () => {
          const value = await parsePdf(sanitized.buffer, {
            reportId: row.id, sourceFileName: reference.fileName, pageCountOverride: actualPages, parseMinExpectedPages: actualPages,
            allowLocalTextFallback: true, enablePythonCrossCheck: true, disableImagePipeline: true, disableImageScoreRescue: true,
            identitySafeguard: safeguard(row), extractionLearningContext: buildMlExtractionLearningContextFromReportRows(rows, { excludeReportId: row.id, minTrainingExamples: 3 }),
          });
          if ((value?._parseState || value?.parseState) === "failed") throw new Error(`Parser failed: ${value?._parseReason || value?.parseReason || "unknown"}`);
          return value;
        });
        await json(path.join(directory, "parsed", `${key}.json`), parsed);
        const learning = await applyMlScoreLearningToParsedProfile({ supabase: snapshotClient(rows), table, parsedProfile: parsed, reportId: row.id });
        const profile = preserveReviewedScores(learning.parsedProfile || parsed, row);
        const candidate = { reportId: row.id, baselineSha256: fingerprint(row), pdf, update: proposedUpdate(row, profile, learning.ml, sanitized.diagnostics, pdf, runId) };
        const validation = validateCandidate(row, candidate);
        const candidateFile = `candidates/${key}.json`;
        await json(path.join(directory, candidateFile), candidate);
        const entry = { reportId: row.id, fileName: reference.fileName, candidateFile, candidateSha256: fingerprint(candidate), status: validation.valid ? "ready" : "blocked", ...validation };
        manifest.entries.push(entry);
        console.log("[reparse-all] staged", entry);
      } catch (error) {
        const entry = { reportId: row.id, fileName: reference.fileName, status: "failed", error: String(error.message || error) };
        manifest.entries.push(entry);
        console.log("[reparse-all] failed", entry);
      }
    }
  }));
  manifest.entries.sort((a, b) => String(a.reportId).localeCompare(String(b.reportId)));
  manifest.finishedAt = new Date().toISOString();
  manifest.readyCount = manifest.entries.filter((entry) => entry.status === "ready").length;
  manifest.stageComplete = targetRows.length > 0 && manifest.readyCount === targetRows.length;
  await json(path.join(directory, "manifest.json"), manifest);
  console.log("[reparse-all] stage finished; no database writes", { directory, ready: manifest.readyCount, total: manifest.pdfCount, stageComplete: manifest.stageComplete });
  if (!manifest.stageComplete) process.exitCode = 2;
}
async function verifyStage(directory) {
  directory = path.resolve(directory);
  const manifest = await readJson(path.join(directory, "manifest.json"));
  const rows = await readJson(path.join(directory, "before.json"));
  assert.equal(fingerprint(rows), manifest.baselineSha256, "Snapshot tampered with or corrupted");
  const targets = rows.filter((row) => storedPdf(row));
  assert.equal(manifest.stageComplete, true, "Entire staging run must be valid before apply");
  assert.equal(manifest.pdfCount, targets.length, "PDF inventory changed");
  assert.equal(manifest.entries.length, targets.length, "Missing candidate entries");
  assert.deepEqual(manifest.entries.map((entry) => entry.reportId).sort(), targets.map((row) => row.id).sort(), "Candidate IDs do not cover all stored PDFs");
  const candidates = [];
  for (const entry of manifest.entries) {
    assert.equal(entry.candidateFile, `candidates/${fileKey(entry.reportId)}.json`, "Unexpected candidate path");
    const candidate = await readJson(path.join(directory, entry.candidateFile));
    assert.equal(fingerprint(candidate), entry.candidateSha256, "Candidate tampered with or corrupted");
    assert.equal(candidate.pdf.backupFile, `pdfs/${fileKey(entry.reportId)}.pdf`, "Unexpected PDF backup path");
    const bytes = await fs.readFile(path.join(directory, candidate.pdf.backupFile));
    assert.equal(sha(bytes), candidate.pdf.sha256, "PDF backup changed");
    assert.equal((await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount(), candidate.pdf.actualPages, "Incorrect physical PDF page count");
    const row = targets.find((value) => value.id === entry.reportId);
    const validation = validateCandidate(row, candidate);
    assert.equal(validation.valid, true, `Candidate ${entry.reportId} blocked: ${validation.issues.join(", ")}`);
    candidates.push({ row, candidate });
  }
  console.log("[reparse-all] offline stage validation passed", { directory, reports: candidates.length });
  return { manifest, candidates, directory };
}
async function apply(directory) {
  const verified = await verifyStage(directory); // local checks precede creating a remote client
  await loadEnv();
  const { manifest, candidates } = verified;
  assert.equal(sha(process.env.SUPABASE_URL || ""), manifest.databaseSha256, "Configured Supabase database differs from staging");
  assert.equal(process.env.SUPABASE_REPORTS_TABLE || "reports", manifest.table, "Reports table differs from staging");
  const supabase = getSupabaseAdmin();
  const currentRows = await inventory(supabase, manifest.table);
  assert.deepEqual(currentRows.filter((row) => storedPdf(row)).map((row) => row.id).sort(), candidates.map(({ row }) => row.id).sort(), "Stored PDF inventory changed; restage before applying");
  const pending = [];
  for (const item of candidates) {
    const current = currentRows.find((row) => row.id === item.row.id);
    const alreadyApplied = current && same(current.results_data, item.candidate.update.results_data) && typeNumber(current.enneagram_type) === typeNumber(item.candidate.update.enneagram_type);
    if (!alreadyApplied) assert.equal(fingerprint(current), item.candidate.baselineSha256, `Concurrent edit on ${item.row.id}; restage required`);
    pending.push({ ...item, alreadyApplied });
  }
  // Compare the source object itself too; a storage replacement must not be silently applied.
  for (const { row, candidate } of pending) {
    const blob = await checked(`verify-source:${row.id}`, () => supabase.storage.from(candidate.pdf.bucket).download(candidate.pdf.storagePath));
    assert.equal(sha(Buffer.from(await blob.arrayBuffer())), candidate.pdf.sha256, `Stored PDF changed for ${row.id}; restage required`);
  }
  const summary = { runId: manifest.runId, startedAt: new Date().toISOString(), entries: [], complete: false, hydration: "pending_browser_verification" };
  const summaryPath = path.join(verified.directory, "after-verify.json");
  await json(summaryPath, summary);
  try {
    for (const { row, candidate, alreadyApplied } of pending) {
      let after;
      if (!alreadyApplied) {
        // PostgreSQL jsonb equality is an atomic compare-and-set guard. No unguarded fallback.
        // If results_data is a json column without equality, this fails safely; no write is made.
        let query = supabase.from(manifest.table).update(candidate.update).eq("id", row.id);
        query = row.results_data == null ? query.is("results_data", null) : query.eq("results_data", typeof row.results_data === "string" ? row.results_data : JSON.stringify(row.results_data));
        if (row.updated_at != null) query = query.eq("updated_at", row.updated_at);
        // Do not retry a mutation blindly: a disconnected successful commit must be reread first.
        const response = await query.select("*");
        if (response.error) {
          const observed = await checked(`reconcile:${row.id}`, () => supabase.from(manifest.table).select("*").eq("id", row.id).single());
          if (!same(observed.results_data, candidate.update.results_data) || typeNumber(observed.enneagram_type) !== typeNumber(candidate.update.enneagram_type)) throw new Error(`Guarded save failed for ${row.id}: ${response.error.message}; rerun --apply only after checking after-verify.json`);
        } else if (!Array.isArray(response.data) || response.data.length !== 1) {
          throw new Error(`Concurrent edit prevented save for ${row.id}; no unguarded update attempted`);
        }
      }
      after = await checked(`after-verify:${row.id}`, () => supabase.from(manifest.table).select("*").eq("id", row.id).single());
      assert.equal(same(after.results_data, candidate.update.results_data), true, `Saved results differ for ${row.id}`);
      assert.equal(typeNumber(after.enneagram_type), typeNumber(candidate.update.enneagram_type), `Saved type differs for ${row.id}`);
      await json(path.join(verified.directory, `after-${fileKey(row.id)}.json`), after);
      summary.entries.push({ reportId: row.id, status: alreadyApplied ? "already_applied_verified" : "applied_verified", afterSha256: fingerprint(after), ...validateCandidate(row, candidate) });
      await json(summaryPath, summary);
      console.log("[reparse-all] saved and reread", { reportId: row.id, alreadyApplied });
    }
    summary.complete = summary.entries.length === candidates.length;
  } catch (error) {
    summary.error = String(error.message || error);
    throw error;
  } finally {
    summary.finishedAt = new Date().toISOString();
    await json(summaryPath, summary);
  }
  console.log("[reparse-all] apply verified", { summaryPath, count: summary.entries.length, hydration: summary.hydration });
}
async function selfTest() {
  const row = { id: "unassigned-old", user_email: null, source: "legacy", report_pdf: { storagePath: "older/report.pdf" }, results_data: { review: { status: "approved", reviewedBy: "fixture" }, ml: { feedback: { labelSource: "admin-review", groundTruthIdentity: { primaryType: 8 }, groundTruthScores: { typeScores: { 8: 90 } } } }, parsedProfile: { primaryType: 8, typeScores: { 8: 90 } } } };
  assert.equal([row, { ...row, id: "newer", user_email: "fixture@example.test" }, { id: "no-pdf" }].filter(storedPdf).length, 2, "Older and unassigned stored PDF rows must be included");
  const pages = [{ pageNumber: 1, extractedText: "First page fixture" }, { pageNumber: 2, extractedText: "Second page fixture" }];
  const profile = { primaryType: 8, _parseState: "complete", parseState: "complete", typeScores: { 8: 10 }, reportContent: { pages, sections: [] }, _parseDiagnostics: { isComplete: true, extraction: { pages: 2, detectedTotalPages: 2 }, verification: { available: true, isVerifiedForHydration: true, mismatchCount: 0, checks: {}, python: { pageCount: 2 }, resolvedFields: { primaryType: 8 } } } };
  const pdf = { fileName: "report.pdf", actualPages: 2, sha256: "fixture" };
  const protectedProfile = preserveReviewedScores(profile, row);
  assert.equal(protectedProfile.typeScores[8], 90);
  const candidate = { reportId: row.id, baselineSha256: fingerprint(row), pdf, update: proposedUpdate(row, protectedProfile, { status: "suggested" }, {}, pdf, "self-test") };
  assert.equal(validateCandidate(row, candidate).valid, true);
  assert.deepEqual(candidate.update.results_data.review, row.results_data.review);
  assert.deepEqual(candidate.update.results_data.ml.feedback, row.results_data.ml.feedback);
  const missing = structuredClone(candidate);
  missing.update.results_data.parsedProfile.reportContent.pages.pop();
  assert.equal(validateCandidate(row, missing).valid, false, "Page coverage loss must block apply");
  assert.notEqual(fingerprint(candidate), fingerprint(missing), "Candidate tampering must change its hash");
  assert.equal(validateCandidate({ ...row, user_email: "edited@example.test" }, candidate).valid, false, "Baseline changes must block apply");
  const mismatched = structuredClone(candidate);
  mismatched.update.results_data.parsedProfile._parseDiagnostics.verification.checks.primaryType = { status: "mismatch" };
  assert.equal(validateCandidate(row, mismatched).valid, false, "Cross-check mismatches must block apply");
  const lostFeedback = structuredClone(candidate);
  delete lostFeedback.update.results_data.ml.feedback;
  assert.equal(validateCandidate(row, lostFeedback).valid, false, "Ground truth must survive");
  const document = await PDFDocument.create();
  document.addPage(); document.addPage();
  assert.equal((await PDFDocument.load(await document.save())).getPageCount(), 2);
  console.log("[reparse-all] offline self-test passed: inventory, real PDF count, coverage, mismatches, baseline/tamper guards, review and ML feedback preservation");
}
function argumentsFrom(argv) {
  const options = { mode: "stage", directory: null, workers: 2 };
  let modeSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--apply", "--verify-stage", "--self-test", "--help", "--stage", "--dry-run"].includes(arg)) {
      if (modeSet) throw new Error("Choose exactly one mode");
      modeSet = true;
      options.mode = ({ "--apply": "apply", "--verify-stage": "verify", "--self-test": "self-test", "--help": "help" })[arg] || "stage";
      if (arg === "--apply" || arg === "--verify-stage") {
        options.directory = argv[++index];
        if (!options.directory || options.directory.startsWith("--")) throw new Error(`${arg} requires a run directory`);
      }
    } else if (arg === "--run-dir") options.directory = argv[++index];
    else if (arg === "--workers") options.workers = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (![1, 2].includes(options.workers)) throw new Error("--workers must be 1 or 2");
  return options;
}
async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  if (options.mode === "help") {
    console.log("Usage:\n  node tmp/reparse-runs/reparse-all-reports.mjs [--stage|--dry-run] [--workers 1|2] [--run-dir NEW_DIRECTORY]\n  node tmp/reparse-runs/reparse-all-reports.mjs --verify-stage RUN_DIRECTORY\n  node tmp/reparse-runs/reparse-all-reports.mjs --apply RUN_DIRECTORY\n  node tmp/reparse-runs/reparse-all-reports.mjs --self-test\n\nDefault stage reads all stored report PDFs and calls Azure parsing, writes private local backups/candidates, and NEVER saves database changes. Apply requires a fully valid stage, unchanged source inventory/PDFs/baselines, and atomic results_data equality support. Partial commits are recorded and rerunning apply reconciles exact previously applied rows. There is no unguarded update or rollback. Real dashboard hydration remains a browser operation. --help, --self-test and --verify-stage make no network calls.");
  } else if (options.mode === "self-test") await selfTest();
  else if (options.mode === "verify") await verifyStage(options.directory);
  else if (options.mode === "apply") await apply(options.directory);
  else await stage(options);
}
main().catch((error) => { console.error("[reparse-all] stopped", String(error.message || error)); process.exitCode = 1; });
