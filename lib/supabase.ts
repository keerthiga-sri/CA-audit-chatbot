import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "https://placeholder-project.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || "placeholder-anon-key";

// Server-side only. Uses the service key, so never import this in a client component.
export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  { auth: { persistSession: false } }
);

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return Boolean(
    url &&
    key &&
    !url.includes("placeholder-project") &&
    !url.includes("your-project")
  );
}


