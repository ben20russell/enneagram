import { getSupabaseAdmin } from "./supabaseAdmin";

function getReportsTable() {
  return process.env.SUPABASE_REPORTS_TABLE || "reports";
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

  const payload = {
    id,
    user_email: userEmail,
    enneagram_type: enneagramType,
    wing: wing ?? null,
    results_data: resultsData ?? null,
    report_pdf: reportPdf ?? null,
    source: source ?? null,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create report in Supabase: ${error.message}`);
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

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list reports for user: ${error.message}`);
  }

  return (data || []).map(mapReportRow);
}

export async function listVisibleReportsByUserEmail(userEmail) {
  const allReports = await listReportsByUserEmail(userEmail);
  const adminImportedReports = allReports.filter((report) => report?.source === "admin-import");
  if (adminImportedReports.length > 0) {
    return adminImportedReports;
  }
  return allReports;
}

export async function hasAdminImportedReports(userEmail) {
  const allReports = await listReportsByUserEmail(userEmail);
  return allReports.some((report) => report?.source === "admin-import");
}
