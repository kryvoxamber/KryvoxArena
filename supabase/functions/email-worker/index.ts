// Drains email_queue through Resend. Retries with backoff (max 5 attempts). Cron secret or EMAIL_MANAGER staff.
import { handler, json } from "../_shared/http.ts";
import { admin, env, requireStaff } from "../_shared/clients.ts";
import { safeEqual } from "../_shared/crypto.ts";
import { sendEmail } from "../_shared/email.ts";
import { renderEmail } from "../_shared/templates.ts";

Deno.serve(handler(async (req) => {
  const cron = req.headers.get("x-cron-secret");
  if (!(cron && safeEqual(cron, env("CRON_SECRET")))) await requireStaff(req, ["EMAIL_MANAGER"]);
  const db = admin();
  const { data: rows } = await db.from("email_queue").select("*").eq("status", "PENDING").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(25);
  const out = { sent: 0, failed: 0, retry: 0 };
  for (const r of rows ?? []) {
    // claim the row so two workers never send the same email
    const { data: claimed } = await db.from("email_queue").update({ status: "SENDING", attempts: r.attempts + 1 }).eq("id", r.id).eq("status", "PENDING").select("id");
    if (!claimed?.length) continue;
    try {
      const payload = await enrich(db, r.template, r.payload ?? {});
      const id = await sendEmail(r.to_email, r.subject, renderEmail(r.template, payload));
      await db.from("email_queue").update({ status: "SENT" }).eq("id", r.id);
      await db.from("email_logs").insert({ queue_id: r.id, to_email: r.to_email, template: r.template, status: "SENT", provider_id: id });
      out.sent++;
    } catch (e) {
      const give = r.attempts + 1 >= 5;
      await db.from("email_queue").update({ status: give ? "FAILED" : "PENDING", next_attempt_at: new Date(Date.now() + 2 ** (r.attempts + 1) * 60_000).toISOString() }).eq("id", r.id);
      await db.from("email_logs").insert({ queue_id: r.id, to_email: r.to_email, template: r.template, status: "FAILED", error: String((e as Error).message).slice(0, 200) });
      give ? out.failed++ : out.retry++;
    }
  }
  return json(out);
}));

async function enrich(db: ReturnType<typeof admin>, template: string, p: Record<string, unknown>) {
  if (template === "REGISTRATION_CONFIRMATION" && p.registration_id) {
    const { data } = await db.from("registrations").select("booking_code, tournaments(title,starts_at), tournament_modes(mode), teams(name)").eq("id", p.registration_id).single();
    if (data) return { tournament: data.tournaments?.title, mode: data.tournament_modes?.mode, team: data.teams?.name, booking_code: data.booking_code, starts_at: data.tournaments?.starts_at };
  }
  return p;
}
