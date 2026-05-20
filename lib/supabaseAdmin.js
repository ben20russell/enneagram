import { createClient } from "@supabase/supabase-js";

let supabaseAdminInstance;

export function getSupabaseStorageBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET || "admin-import-reports";
}

export function getSupabaseAdmin() {
  if (!supabaseAdminInstance) {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    supabaseAdminInstance = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseAdminInstance;
}
