import { handler, json, HttpError } from "../_shared/http.ts";
import { admin, requireUser } from "../_shared/clients.ts";
import * as razorpay from "../_shared/payments/razorpay.ts";
import * as phonepe from "../_shared/payments/phonepe.ts";
import { phonepeCfg, razorpayCfg } from "../_shared/payments/config.ts";
import { methodEnv, type OrderRow, logActivity } from "../_shared/payments/service.ts";

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const b = await req.json().catch(() => ({}));
  const db = admin();
  const method = String(b.method ?? "");
  if (!["PHONEPE", "RAZORPAY", "MANUAL_UPI"].includes(method)) throw new HttpError(400, "INVALID_METHOD");

  // Re-display instructions for an existing manual order (read-only).
  if (b.order_id && method === "MANUAL_UPI") {
    const { data: o } = await db.from("payment_orders").select("*").eq("id", b.order_id).eq("user_id", user.id).eq("method_code", "MANUAL_UPI").maybeSingle();
    if (!o) throw new HttpError(404, "ORDER_NOT_FOUND");
    return json(await manualInfo(db, o.id));
  }

  // The DB function enforces ownership, compliance gate, method availability, single active attempt and amount limits.
  const { data: order, error } = await db.rpc("create_payment_order", { p_user: user.id, p_registration: b.registration_id, p_method: method, p_idempotency_key: b.idempotency_key ?? null });
  if (error) throw new HttpError(400, (error.message.match(/[A-Z_]{6,}/) ?? ["PAYMENT_CREATE_FAILED"])[0]);
  const o = order as OrderRow;
  if (method === "MANUAL_UPI") return json({ order_id: o.id, ...(await manualInfo(db, o.id)) });
  if (o.provider_order_id) return json({ order_id: o.id, already_created: true });   // idempotent replay

  try {
    if (method === "RAZORPAY") {
      const r = await razorpay.createOrder(razorpayCfg(), o);
      await db.from("payment_orders").update({ provider_order_id: r.providerOrderId, status: "PENDING" }).eq("id", o.id);
      return json({ order_id: o.id, razorpay: r.checkout });
    }
    const ttl = Math.max(300, Math.floor((new Date(o.expires_at).getTime() - Date.now()) / 1000));
    const r = await phonepe.createOrder(phonepeCfg(await methodEnv(db, "PHONEPE")), o, ttl);
    await db.from("payment_orders").update({ provider_order_id: r.providerOrderId, status: "PENDING" }).eq("id", o.id);
    return json({ order_id: o.id, redirect_url: r.redirectUrl });
  } catch (e) {
    // Provider call failed before the player could pay: close this attempt so they can try again (or another method).
    await db.from("payment_orders").update({ status: "FAILED", provider_raw_status: "CREATE_FAILED" }).eq("id", o.id).eq("status", "CREATED");
    await logActivity(db, method, "CREATE_ORDER_FAILED", { order: o.internal_order_reference, error: String((e as Error).message).slice(0, 120) });
    throw new HttpError(502, "GATEWAY_UNAVAILABLE");
  }
}));

async function manualInfo(db: ReturnType<typeof admin>, _orderId: string) {
  const { data: m } = await db.from("payment_method_settings").select("config_public,public_instructions").eq("method_code", "MANUAL_UPI").single();
  const cfg = (m?.config_public ?? {}) as Record<string, string>;
  let qr_url: string | null = null;
  if (cfg.qr_path) qr_url = db.storage.from("payment-assets").getPublicUrl(cfg.qr_path).data.publicUrl;
  return { upi: { vpa: cfg.upi_id ?? null, payee_name: cfg.payee_name ?? null, qr_url }, instructions: m?.public_instructions ?? "" };
}
