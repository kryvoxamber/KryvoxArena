// For email-OTP sign-ins: Supabase itself already proved inbox control (JWT amr contains a fresh 'otp' method).
// Google sign-ins do NOT qualify here; they must use otp-send / otp-verify.
import { handler, json, HttpError } from "../_shared/http.ts";
import { admin, requireUser } from "../_shared/clients.ts";
import { decodeJwtPayload } from "../_shared/crypto.ts";
import { recentOtpLogin } from "../_shared/otp.ts";

Deno.serve(handler(async (req) => {
  const { user, token } = await requireUser(req);
  if (!user.email_confirmed_at || !recentOtpLogin(decodeJwtPayload(token))) throw new HttpError(403, "OTP_LOGIN_REQUIRED");
  await admin().from("profiles").update({ email_verified: true, email_verified_at: new Date().toISOString() }).eq("id", user.id);
  return json({ ok: true });
}));
