import { handler, json, HttpError } from "../_shared/http.ts";
import { admin, requireUser } from "../_shared/clients.ts";
import * as razorpay from "../_shared/payments/razorpay.ts";
import { razorpayCfg } from "../_shared/payments/config.ts";
import { type OrderRow, providerStatus, settle } from "../_shared/payments/service.ts";

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const b = await req.json().catch(() => ({}));
  const db = admin();
  const { data } = await db.from("payment_orders").select("*").eq("id", b.order_id).eq("user_id", user.id).maybeSingle();
  if (!data) throw new HttpError(404, "ORDER_NOT_FOUND");
  const o = data as OrderRow;
  if (o.method_code === "MANUAL_UPI") return json({ status: o.status });
  if (["SUCCESS", "FAILED", "EXPIRED", "CANCELLED", "REJECTED", "REFUNDED"].includes(o.status)) return json({ status: o.status });

  // A bad checkout signature is rejected, but a valid one is NOT trusted either: we still ask the gateway.
  if (o.method_code === "RAZORPAY" && b.razorpay) {
    const ok = await razorpay.verifyCheckoutSignature(razorpayCfg(), String(b.razorpay.razorpay_order_id), String(b.razorpay.razorpay_payment_id), String(b.razorpay.razorpay_signature));
    if (!ok || b.razorpay.razorpay_order_id !== o.provider_order_id) throw new HttpError(400, "INVALID_SIGNATURE");
  }
  const s = await providerStatus(db, o);
  const out = await settle(db, o, s);
  return json({ status: out.status });
}));
