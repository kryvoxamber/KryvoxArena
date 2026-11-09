import { handler, json, HttpError } from "../_shared/http.ts";
import { admin, requireUser, env } from "../_shared/clients.ts";
import { randomDigits } from "../_shared/crypto.ts";
import { otpHash, OTP_TTL_MIN, OTP_MAX_SENDS_PER_10_MIN } from "../_shared/otp.ts";
import { sendEmail, layout, esc } from "../_shared/email.ts";

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  if (!user.email) throw new HttpError(400, "NO_EMAIL");
  const db = admin();
  const { data: prof } = await db.from("profiles").select("email_verified").eq("id", user.id).maybeSingle();
  if (prof?.email_verified) return json({ ok: true, already_verified: true });

  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await db.from("email_verification_otps").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= OTP_MAX_SENDS_PER_10_MIN) throw new HttpError(429, "RATE_LIMITED");

  const pepper = env("OTP_PEPPER");
  const code = randomDigits(6);
  // Older unused codes stop working as soon as a new one is issued.
  await db.from("email_verification_otps").update({ consumed_at: new Date().toISOString() }).eq("user_id", user.id).is("consumed_at", null);
  const { error } = await db.from("email_verification_otps").insert({
    user_id: user.id, code_hash: await otpHash(pepper, user.id, code), expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString()
  });
  if (error) throw new HttpError(500, "INTERNAL");

  const html = layout("Email verification code", `<p>Aapka code:</p><p style="font-size:32px;letter-spacing:8px;font-weight:bold">${esc(code)}</p><p>Ye ${OTP_TTL_MIN} minute mein expire ho jayega. Ye code kisi ko mat batao.</p>`);
  try {
    const id = await sendEmail(user.email, "Kryvox Arena verification code", html);
    await db.from("email_logs").insert({ to_email: user.email, template: "OTP", status: "SENT", provider_id: id });
  } catch (e) {
    await db.from("email_logs").insert({ to_email: user.email, template: "OTP", status: "FAILED", error: String((e as Error).message).slice(0, 200) });
    throw e;
  }
  return json({ ok: true });
}));
