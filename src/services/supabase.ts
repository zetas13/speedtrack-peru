import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Only a publishable/anon key belongs in this bundle. RLS is the security boundary.
export const supabase = url && key ? createClient(url, key) : null;
export const authRedirect =
  import.meta.env.VITE_AUTH_REDIRECT_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:5173");
