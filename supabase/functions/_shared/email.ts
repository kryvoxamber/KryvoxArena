import { env } from "./clients.ts";
import { HttpError } from "./http.ts";

export { esc, layout } from "./html.ts";

// Sends through Resend. Throws if Resend is not configured: emails are never faked.
export async function sendEmail(to: string, subject: string, html: string): Promise<string> {
  const key = env("RESEND_API_KEY"); const from = env("EMAIL_FROM");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `EMAIL_PROVIDER_ERROR:${res.status}`);
  return String(out.id ?? "");
}
