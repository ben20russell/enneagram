import { getSupabaseAdmin, getSupabaseStorageBucket } from "../lib/supabaseAdmin.js";
import { parsePdf } from "../lib/parsePdf.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) return;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || process.env[key]) return;
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const userEmail = (process.argv[2] || "ben20russell@gmail.com").trim().toLowerCase();
const table = process.env.SUPABASE_REPORTS_TABLE || "reports";
const supabase = getSupabaseAdmin();

async function main() {
  const { data: report, error: reportErr } = await supabase
    .from(table)
    .select("*")
    .ilike("user_email", userEmail)
    .eq("source", "admin-import")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reportErr) throw new Error(`Failed to fetch assigned report row: ${reportErr.message}`);
  if (!report) throw new Error(`No admin-import report found for ${userEmail}`);

  const bucket = report?.report_pdf?.bucket || getSupabaseStorageBucket();
  const storagePath = report?.report_pdf?.storagePath;
  const fileName = report?.report_pdf?.fileName || null;

  if (!storagePath) {
    throw new Error("Assigned report row has no report_pdf.storagePath");
  }

  const { data: fileBlob, error: downloadErr } = await supabase.storage
    .from(bucket)
    .download(storagePath);

  if (downloadErr || !fileBlob) {
    throw new Error(`Failed to download assigned PDF: ${downloadErr?.message || "unknown error"}`);
  }

  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());
  const parsed = await parsePdf(pdfBuffer);

  const nextResultsData = {
    ...(report.results_data && typeof report.results_data === "object" ? report.results_data : {}),
    ingestion: {
      ...(report.results_data?.ingestion || {}),
      status: "ready",
      mode: "admin-import-auto",
      ingestedAt: new Date().toISOString(),
      reportId: report.id,
      parser: {
        provider: "azure-openai",
        model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini",
      },
    },
    dashboardContext: {
      ...(report.results_data?.dashboardContext || {}),
      detectedType: parsed?.primaryType ? String(parsed.primaryType) : null,
      detectedTypeSource: "azure-openai:gpt-5.4-mini",
      sourceFileName: fileName,
      basicFear: parsed?.coreFear || null,
      basicDesire: parsed?.coreDesire || null,
      passion: report?.results_data?.dashboardContext?.passion || null,
      reportSummary: parsed?.reportSummary || null,
    },
    parsedProfile: parsed,
  };

  const { error: updateErr } = await supabase
    .from(table)
    .update({
      results_data: nextResultsData,
      enneagram_type: parsed?.primaryType ? String(parsed.primaryType) : report.enneagram_type,
    })
    .eq("id", report.id);

  if (updateErr) throw new Error(`Failed to update parsed results_data: ${updateErr.message}`);

  console.log(
    JSON.stringify(
      {
        success: true,
        reportId: report.id,
        userEmail,
        bucket,
        storagePath,
        sourceFileName: fileName,
        parsedPrimaryType: parsed?.primaryType || null,
        parsedInstinctualVariant: parsed?.instinctualVariant || null,
        parserModel: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[reparse-assigned-report] failed", String(error?.message || error));
  process.exit(1);
});
