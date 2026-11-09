// PhonePe Payment Gateway (Standard Checkout, OAuth "O-Bearer" flow). Endpoint paths follow PhonePe's PG v2 docs;
// they MUST be re-verified against the current docs / sandbox with your merchant credentials before go-live.
import { safeEqual, sha256Hex } from "../crypto.ts";
import { type CreateResult, type Fetch, fromPaise, type OrderRef, type StatusResult, toPaise } from "./types.ts";

export interface PpCfg { clientId: string; clientSecret: string; clientVersion: string; env: "SANDBOX" | "PRODUCTION"; redirectUrl: string; webhookUser?: string; webhookPass?: string; }
const base = (env: PpCfg["env"]) => env === "PRODUCTION"
  ? { token: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token", pg: "https://api.phonepe.com/apis/pg" }
  : { token: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token", pg: "https://api-preprod.phonepe.com/apis/pg-sandbox" };

async function token(c: PpCfg, f: Fetch): Promise<string> {
  const res = await f(base(c.env).token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_version: c.clientVersion, client_secret: c.clientSecret, grant_type: "client_credentials" }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`PHONEPE_AUTH_FAILED:${res.status}`);
  return j.access_token;
}
export async function createOrder(c: PpCfg, o: OrderRef, expireSeconds: number, f: Fetch = fetch): Promise<CreateResult> {
  const t = await token(c, f);
  const res = await f(`${base(c.env).pg}/checkout/v2/pay`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${t}` },
    body: JSON.stringify({ merchantOrderId: o.internal_order_reference, amount: toPaise(o.amount), expireAfter: Math.max(300, expireSeconds),
      paymentFlow: { type: "PG_CHECKOUT", message: "Kryvox Arena tournament entry", merchantUrls: { redirectUrl: `${c.redirectUrl}?ref=${o.internal_order_reference}` } } }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.redirectUrl) throw new Error(`PHONEPE_CREATE_FAILED:${res.status}`);
  return { providerOrderId: j.orderId ?? o.internal_order_reference, redirectUrl: j.redirectUrl };
}
export async function fetchStatus(c: PpCfg, o: OrderRef, f: Fetch = fetch): Promise<StatusResult> {
  const t = await token(c, f);
  const res = await f(`${base(c.env).pg}/checkout/v2/order/${encodeURIComponent(o.internal_order_reference)}/status?details=false`, { headers: { Authorization: `O-Bearer ${t}` } });
  const j = await res.json().catch(() => ({}));
  if (res.status === 404) return { status: "PENDING", providerTxnId: null, amount: null, currency: null, rawStatus: "NOT_FOUND" };
  if (!res.ok) throw new Error(`PHONEPE_STATUS_FAILED:${res.status}`);
  return mapPhonePeState(j);
}
export function mapPhonePeState(j: { state?: string; amount?: number; paymentDetails?: Array<{ transactionId?: string; state?: string }> }): StatusResult {
  const st = String(j.state ?? "").toUpperCase();
  const pd = (j.paymentDetails ?? []).find((p) => String(p.state).toUpperCase() === "COMPLETED") ?? j.paymentDetails?.[0];
  if (st === "COMPLETED") return { status: "SUCCESS", providerTxnId: pd?.transactionId ?? null, amount: j.amount != null ? fromPaise(j.amount) : null, currency: "INR", rawStatus: st };
  if (st === "FAILED") return { status: "FAILED", providerTxnId: null, amount: null, currency: null, rawStatus: st };
  return { status: "PENDING", providerTxnId: null, amount: null, currency: null, rawStatus: st || "UNKNOWN" };
}
// Webhook auth: Authorization header must equal SHA256("username:password") configured in the PhonePe dashboard.
export async function verifyWebhookAuth(user: string | undefined, pass: string | undefined, authHeader: string | null): Promise<boolean> {
  if (!user || !pass || !authHeader) return false;
  const expected = await sha256Hex(`${user}:${pass}`);
  return safeEqual(expected, authHeader.replace(/^SHA256\(?|\)?$/gi, "").trim().toLowerCase());
}
export function parseWebhook(b: { event?: string; payload?: { merchantOrderId?: string; orderId?: string; state?: string } }) {
  return { eventType: b.event ?? "unknown", merchantOrderId: b.payload?.merchantOrderId ?? null, providerOrderId: b.payload?.orderId ?? null,
    eventId: `${b.event}:${b.payload?.orderId ?? b.payload?.merchantOrderId}:${b.payload?.state}` };
}
