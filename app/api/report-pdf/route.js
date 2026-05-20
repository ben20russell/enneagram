import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getAssignedReportByUserEmail } from "../../../lib/reportsStore";
import { getSupabaseAdmin, getSupabaseStorageBucket } from "../../../lib/supabaseAdmin";
import { authOptions } from "../auth/[...nextauth]/route";

function getReportsTable() {
  return process.env.SUPABASE_REPORTS_TABLE || "reports";
}

async function resolveStoragePathByFileName({ supabaseAdmin, bucket, fileName }) {
  if (!fileName) return null;

  const { data, error } = await supabaseAdmin
    .schema("storage")
    .from("objects")
    .select("name, created_at")
    .eq("bucket_id", bucket)
    .or(`name.eq.${fileName},name.ilike.%/${fileName}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.log("[report-pdf] Failed fallback storage path lookup", {
      bucket,
      fileName,
      details: error?.message || null,
    });
    return null;
  }

  return data?.[0]?.name || null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;

  if (!userEmail) {
    return NextResponse.redirect(new URL("/", process.env.NEXTAUTH_URL || "http://127.0.0.1:3000"));
  }

  try {
    const assignedReport = await getAssignedReportByUserEmail(userEmail);
    let storagePath = assignedReport?.reportPdf?.storagePath || null;
    const fileName = assignedReport?.reportPdf?.fileName || null;
    const bucket = assignedReport?.reportPdf?.bucket || getSupabaseStorageBucket();

    if (!storagePath) {
      return NextResponse.json(
        { error: "No assigned report PDF found for this account." },
        { status: 404 },
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    let { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 10);

    if ((error || !data?.signedUrl) && error?.statusCode === "404") {
      const resolvedStoragePath = await resolveStoragePathByFileName({
        supabaseAdmin,
        bucket,
        fileName,
      });

      if (resolvedStoragePath && resolvedStoragePath !== storagePath) {
        console.log("[report-pdf] Auto-correcting stale storage path", {
          userEmail,
          previousStoragePath: storagePath,
          resolvedStoragePath,
          fileName,
        });

        const nextReportPdf = {
          ...(assignedReport?.reportPdf || {}),
          storagePath: resolvedStoragePath,
          bucket,
        };

        const reportsTable = getReportsTable();
        const { error: updateError } = await supabaseAdmin
          .from(reportsTable)
          .update({ report_pdf: nextReportPdf })
          .eq("id", assignedReport.id);

        if (!updateError) {
          storagePath = resolvedStoragePath;
          const retried = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrl(storagePath, 60 * 10);
          data = retried.data;
          error = retried.error;
        } else {
          console.log("[report-pdf] Failed to persist corrected storage path", {
            userEmail,
            reportsTable,
            details: updateError?.message || null,
          });
        }
      }
    }

    if (error || !data?.signedUrl) {
      const details = {
        userEmail,
        bucket,
        storagePath,
        supabaseErrorMessage: error?.message || null,
        supabaseErrorName: error?.name || null,
        supabaseErrorStatusCode: error?.statusCode || null,
      };
      console.log("[report-pdf] Failed to create signed URL", details);
      return NextResponse.json(
        {
          error: "Failed to create signed URL for assigned report PDF.",
          details,
        },
        { status: 500 },
      );
    }

    return NextResponse.redirect(data.signedUrl, 302);
  } catch (error) {
    const details = String(error?.message || "Unknown report PDF error");
    console.log("[report-pdf] Unexpected exception", {
      userEmail,
      details,
      stack: error?.stack,
    });
    return NextResponse.json(
      { error: details },
      { status: 500 },
    );
  }
}
