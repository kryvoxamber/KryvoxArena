import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { HttpError } from "./http.ts";

export const env = (k: string, required = true): string => {
  const v = Deno.env.get(k) ?? "";
  if (!v && required) throw new HttpError(503, `NOT_CONFIGURED:${k}`);
  return v;
};
// Service-role client: bypasses RLS. Only ever used inside Edge Functions, never sent to the browser.
export const admin = (): SupabaseClient =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

export async function requireUser(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "NOT_AUTHENTICATED");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "NOT_AUTHENTICATED");
  return { user: data.user, token };
}
export async function requireStaff(req: Request, roles: string[] = []) {
  const u = await requireUser(req);
  const { data } = await admin().from("admin_roles").select("role").eq("user_id", u.user.id);
  const have = (data ?? []).map((r: { role: string }) => r.role);
  if (!have.includes("SUPER_ADMIN") && !roles.some((r) => have.includes(r))) throw new HttpError(403, "FORBIDDEN");
  return u;
}
