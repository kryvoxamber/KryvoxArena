// Public endpoint (verify_jwt = false). Trust comes ONLY from the HMAC signature over the raw body.
import { admin, env } from "../_shared/clients.ts";
import * as razorpay from "../_shared/payments/razorpay.ts";
import { type OrderRow, providerStatus, settle } from "../_shared/payments/service.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();
  const db = admin();
  const valid = await razorpay.verifyWebhookSignature(env("RAZORPAY_WEBHOOK_SECRET"), raw, req.headers.get("x-razorpay-signature"));
  let body: any = {}; try { body = JSON.parse(raw); } catch { /* keep {} */ }
  const ev = razorpay.parseWebhook(body, req.headers.get("x-razorpay-event-id"));
  const { error: dup } = await db.from("payment_webhook_events").insert({ provider: "RAZORPAY", provider_event_id: ev.eventId, event_type: ev.eventType, signature_verified: valid, payload: valid ? body : null });
  if (!valid) return new Response("invalid signature", { status: 401 });
  if (dup) return new Response("duplicate", { status: 200 });          // replayed event: already handled
  try {
    if (ev.providerOrderId && ["payment.captured", "order.paid", "payment.failed"].includes(ev.eventType)) {
      const { data } = await db.from("payment_orders").select("*").eq("provider_order_id", ev.providerOrderId).eq("method_code", "RAZORPAY").maybeSingle();
      if (data) await settle(db, data as OrderRow, await providerStatus(db, data as OrderRow));   // re-verify with Razorpay, don't trust the payload
    }
    await db.from("payment_webhook_events").update({ processing_status: "PROCESSED", processed_at: new Date().toISOString() }).eq("provider", "RAZORPAY").eq("provider_event_id", ev.eventId);
  } catch (e) {
    await db.from("payment_webhook_events").update({ processing_status: "FAILED", error: String((e as Error).message).slice(0, 200) }).eq("provider", "RAZORPAY").eq("provider_event_id", ev.eventId);
    return new Response("retry", { status: 500 });                        // Razorpay retries; reconcile job is the safety net
  }
  return new Response("ok");
});
