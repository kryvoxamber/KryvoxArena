import { hmacHex, safeEqual } from "../crypto.ts";
import { type CreateResult, type Fetch, fromPaise, type OrderRef, type StatusResult, toPaise } from "./types.ts";

export interface RzCfg { keyId: string; keySecret: string; webhookSecret?: string; }
const API = "https://api.razorpay.com/v1";
const auth = (c: RzCfg) => "Basic " + btoa(`${c.keyId}:${c.keySecret}`);

export async function createOrder(c: RzCfg, o: OrderRef, f: Fetch = fetch): Promise<CreateResult> {
  const res = await f(`${API}/orders`, { method: "POST", headers: { Authorization: auth(c), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: toPaise(o.amount), currency: "INR", receipt: o.internal_order_reference, notes: { order_ref: o.internal_order_reference } }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id) throw new Error(`RAZORPAY_CREATE_FAILED:${res.status}`);
  return { providerOrderId: j.id, checkout: { key_id: c.keyId, order_id: j.id, amount: j.amount } };
}
// Checkout success callback signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
export async function verifyCheckoutSignature(c: RzCfg, orderId: string, paymentId: string, signature: string): Promise<boolean> {
  return safeEqual(await hmacHex(c.keySecret, `${orderId}|${paymentId}`), String(signature ?? ""));
}
// Webhook: X-Razorpay-Signature = HMAC_SHA256(rawBody, webhook_secret)
export async function verifyWebhookSignature(webhookSecret: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!webhookSecret || !signature) return false;
  return safeEqual(await hmacHex(webhookSecret, rawBody), signature);
}
// Ask Razorpay (server to server) what happened to this order. Success = a captured payment of the exact amount.
export async function fetchStatus(c: RzCfg, o: OrderRef, f: Fetch = fetch): Promise<StatusResult> {
  if (!o.provider_order_id) return { status: "PENDING", providerTxnId: null, amount: null, currency: null, rawStatus: "NO_PROVIDER_ORDER" };
  const res = await f(`${API}/orders/${encodeURIComponent(o.provider_order_id)}/payments`, { headers: { Authorization: auth(c) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RAZORPAY_STATUS_FAILED:${res.status}`);
  return mapRazorpayPayments(j.items ?? []);
}
export function mapRazorpayPayments(items: Array<{ id: string; status: string; amount: number; currency: string; captured?: boolean }>): StatusResult {
  const ok = items.find((p) => p.status === "captured" || p.captured === true);
  if (ok) return { status: "SUCCESS", providerTxnId: ok.id, amount: fromPaise(ok.amount), currency: ok.currency, rawStatus: "captured" };
  if (items.some((p) => p.status === "authorized")) return { status: "PENDING", providerTxnId: null, amount: null, currency: null, rawStatus: "authorized" };
  if (items.length && items.every((p) => p.status === "failed")) return { status: "FAILED", providerTxnId: null, amount: null, currency: null, rawStatus: "failed" };
  return { status: "PENDING", providerTxnId: null, amount: null, currency: null, rawStatus: items.length ? items[items.length - 1].status : "created" };
}
export function parseWebhook(body: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } } }; created_at?: number }, headerEventId: string | null) {
  const p = body.payload?.payment?.entity;
  return { eventId: headerEventId ?? `${body.event}:${p?.id}:${body.created_at}`, eventType: body.event ?? "unknown", providerOrderId: p?.order_id ?? null };
}
