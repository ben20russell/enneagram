import { getSupabaseAdmin } from "./supabaseAdmin";

function getReportsTable() {
  return process.env.SUPABASE_REPORTS_TABLE || "reports";
}

function normalizeUserEmail(userEmail) {
  return String(userEmail || "").trim().toLowerCase();
}

function normalizeResultsData(resultsData) {
  if (!resultsData) return null;
  if (typeof resultsData === "object") return resultsData;
  if (typeof resultsData === "string") {
    try {
      const parsed = JSON.parse(resultsData);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_error) {
      return null;
    }
  }
  return null;
}

function isMissingSourceColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) return false;
  const referencesSourceColumn =
    message.includes("'source'") || message.includes("\"source\"") || message.includes(" source ");
  const referencesMissingColumn =
    message.includes("column") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"));
  return referencesSourceColumn && referencesMissingColumn;
}

function looksLikeAdminImportReport(row) {
  if (!row || typeof row !== "object") return false;
  if (String(row.source || "").toLowerCase() === "admin-import") return true;

  const results = normalizeResultsData(row.results_data);
  const ingestionMode = String(results?.ingestion?.mode || "").toLowerCase();
  if (ingestionMode === "admin-import-auto") return true;

  return false;
}

function mapReportRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userEmail: row.user_email,
    enneagramType: row.enneagram_type,
    wing: row.wing,
    resultsData: row.results_data,
    reportPdf: row.report_pdf,
    source: row.source,
    createdAt: row.created_at,
  };
}

export async function createReport({
  id,
  userEmail,
  enneagramType,
  wing,
  resultsData,
  reportPdf,
  source,
}) {
  const supabase = getSupabaseAdmin();
  const table = getReportsTable();
  const normalizedUserEmail = normalizeUserEmail(userEmail);

  const payload = {
    id,
    user_email: normalizedUserEmail,
    enneagram_type: enneagramType,
    wing: wing ?? null,
    results_data: resultsData ?? null,
    report_pdf: reportPdf ?? null,
    source: source ?? null,
    created_at: new Date().toISOString(),
  };

  let { data, error: insertError } = await supabase
    .from(table)
    .insert(payload)
    .select("*")
    .single();

  if (insertError && isMissingSourceColumnError(insertError)) {
    console.log("[reportsStore] Source column missing; retrying insert without source", {
      table,
      id,
      userEmail: normalizedUserEmail,
    });
    const { source: _ignoredSource, ...payloadWithoutSource } = payload;
    const retryResult = await supabase
      .from(table)
      .insert(payloadWithoutSource)
      .select("*")
      .single();
    data = retryResult.data;
    insertError = retryResult.error;
  }

  if (insertError) {
    throw new Error(`Failed to create report in Supabase: ${insertError.message}`);
  }

  return mapReportRow(data);
}

export async function getReportById(id) {
  const supabase = getSupabaseAdmin();
  const table = getReportsTable();

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch report by id: ${error.message}`);
  }

  return mapReportRow(data);
}

export async function listReportsByUserEmail(userEmail) {
  const supabase = getSupabaseAdmin();
  const table = getReportsTable();
  const normalizedUserEmail = normalizeUserEmail(userEmail);

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .ilike("user_email", normalizedUserEmail)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list reports for user: ${error.message}`);
  }

  return (data || []).map(mapReportRow);
}

export async function getAssignedReportByUserEmail(userEmail) {
  const supabase = getSupabaseAdmin();
  const table = getReportsTable();
  const normalizedUserEmail = normalizeUserEmail(userEmail);

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .ilike("user_email", normalizedUserEmail)
    .eq("source", "admin-import")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && isMissingSourceColumnError(error)) {
    console.log("[reportsStore] Source column missing; falling back to ingestion markers", {
      table,
      userEmail: normalizedUserEmail,
    });
    const { data: fallbackRows, error: fallbackError } = await supabase
      .from(table)
      .select("*")
      .ilike("user_email", normalizedUserEmail)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(25);

    if (fallbackError) {
      throw new Error(`Failed to fetch assigned report for user: ${fallbackError.message}`);
    }

    const fallbackRow = (fallbackRows || []).find((row) => looksLikeAdminImportReport(row)) || null;
    return mapReportRow(fallbackRow);
  }

  if (error) {
    throw new Error(`Failed to fetch assigned report for user: ${error.message}`);
  }

  return mapReportRow(data);
}
