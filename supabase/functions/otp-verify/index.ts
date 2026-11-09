import { handler, json, HttpError } from "../_shared/http.ts";
import { admin, requireUser, env } from "../_shared/clients.ts";
import { otpMatches, OTP_MAX_ATTEMPTS } from "../_shared/otp.ts";

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const { code } = await req.json().catch(() => ({ code: "" }));
  const db = admin();
  const { data: row } = await db.from("email_verification_otps").select("*").eq("user_id", user.id)
    .is("consumed_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) throw new HttpError(400, "OTP_EXPIRED_OR_MISSING");
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, "OTP_TOO_MANY_ATTEMPTS");
  await db.from("email_verification_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
  if (!(await otpMatches(env("OTP_PEPPER"), user.id, String(code), row.code_hash))) throw new HttpError(400, "OTP_INVALID");
  await db.from("email_verification_otps").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
  await db.from("profiles").update({ email_verified: true, email_verified_at: new Date().toISOString() }).eq("id", user.id);
  return json({ ok: true });
}));
