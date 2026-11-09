// Supabase browser client (anon key only). Loaded lazily from a pinned ESM build so there is no build step.
import { CONFIG, configured } from "./config.js";
let client = null;
export async function sb() {
  if (!configured()) return null;
  if (client) return client;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
  });
  return client;
}
// Call an Edge Function with the user's JWT. Returns parsed JSON or throws Error(code).
export async function fn(name, body = {}) {
  const c = await sb();
  if (!c) throw new Error("Backend configure nahi hai (assets/js/config.js).");
  const { data: s } = await c.auth.getSession();
  const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_ANON_KEY,
               Authorization: `Bearer ${s.session ? s.session.access_token : CONFIG.SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
export async function rpc(name, args = {}) {
  const c = await sb();
  const { data, error } = await c.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
