// Public endpoint (verify_jwt = false). Authorization header must be SHA256(username:password) from the PhonePe dashboard.
import { admin, env } from "../_shared/clients.ts";
import * as phonepe from "../_shared/payments/phonepe.ts";
import { type OrderRow, providerStatus, settle } from "../_shared/payments/service.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();
  const db = admin();
  const valid = await phonepe.verifyWebhookAuth(env("PHONEPE_WEBHOOK_USERNAME"), env("PHONEPE_WEBHOOK_PASSWORD"), req.headers.get("authorization"));
  let body: any = {}; try { body = JSON.parse(raw); } catch { /* keep {} */ }
  const ev = phonepe.parseWebhook(body);
  const { error: dup } = await db.from("payment_webhook_events").insert({ provider: "PHONEPE", provider_event_id: ev.eventId, event_type: ev.eventType, signature_verified: valid, payload: valid ? body : null });
  if (!valid) return new Response("unauthorized", { status: 401 });
  if (dup) return new Response("duplicate", { status: 200 });
  try {
    if (ev.merchantOrderId) {
      const { data } = await db.from("payment_orders").select("*").eq("internal_order_reference", ev.merchantOrderId).eq("method_code", "PHONEPE").maybeSingle();
      if (data) await settle(db, data as OrderRow, await providerStatus(db, data as OrderRow));   // re-verify via PhonePe order-status API
    }
    await db.from("payment_webhook_events").update({ processing_status: "PROCESSED", processed_at: new Date().toISOString() }).eq("provider", "PHONEPE").eq("provider_event_id", ev.eventId);
  } catch (e) {
    await db.from("payment_webhook_events").update({ processing_status: "FAILED", error: String((e as Error).message).slice(0, 200) }).eq("provider", "PHONEPE").eq("provider_event_id", ev.eventId);
    return new Response("retry", { status: 500 });
  }
  return new Response("ok");
});
