// Staff-only: queue a broadcast or room-details email to every CONFIRMED registrant of a tournament (deduplicated).
import { handler, json, HttpError } from "../_shared/http.ts";
import { admin, requireStaff } from "../_shared/clients.ts";

Deno.serve(handler(async (req) => {
  const { user } = await requireStaff(req, ["EMAIL_MANAGER", "TOURNAMENT_MANAGER"]);
  const b = await req.json().catch(() => ({}));
  const db = admin();
  const kind = String(b.kind ?? "");
  if (!["CUSTOM", "ROOM_DETAILS", "ROOM_DETAILS_UPDATE", "MATCH_REMINDER", "MATCH_STARTING", "TOURNAMENT_POSTPONED", "TOURNAMENT_CANCELLED", "WINNER_ANNOUNCEMENT"].includes(kind)) throw new HttpError(400, "INVALID_KIND");
  const { data: t } = await db.from("tournaments").select("id,title,starts_at").eq("id", b.tournament_id).maybeSingle();
  if (!t) throw new HttpError(404, "TOURNAMENT_NOT_FOUND");
  let extra: Record<string, unknown> = {};
  if (kind.startsWith("ROOM_DETAILS")) {
    const { data: room } = await db.from("room_credentials").select("*, matches(title)").eq("id", b.room_id).eq("tournament_id", t.id).eq("status", "PUBLISHED").maybeSingle();
    if (!room) throw new HttpError(400, "ROOM_NOT_PUBLISHED");
    extra = { match: room.matches?.title, room_id: room.room_id, room_password: room.room_password, version: room.version };
  }
  const subject = String(b.subject ?? (kind === "CUSTOM" ? "" : kind.replaceAll("_", " ").toLowerCase())).slice(0, 150);
  if (!subject) throw new HttpError(400, "SUBJECT_REQUIRED");
  const { data: regs } = await db.from("registrations").select("user_id, contact_email").eq("tournament_id", t.id).eq("status", "CONFIRMED");
  const batch = String(b.batch_id ?? crypto.randomUUID());
  const rows = (regs ?? []).map((r: { user_id: string; contact_email: string }) => ({
    template: kind, recipient_user: r.user_id, to_email: r.contact_email, subject, created_by: user.id,
    payload: { tournament: t.title, starts_at: t.starts_at, title: subject, message: String(b.message ?? "").slice(0, 3000), ...extra },
    dedupe_key: `${kind}:${t.id}:${batch}:${r.contact_email}`
  }));
  if (rows.length) await db.from("email_queue").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  await db.from("admin_audit_logs").insert({ actor_id: user.id, action: "email.enqueue", entity: "tournament", entity_id: t.id, new_value: { kind, recipients: rows.length, batch }, reason: subject });
  return json({ queued: rows.length, batch_id: batch });
}));
