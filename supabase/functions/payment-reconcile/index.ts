// Safety net: re-checks every unsettled automatic order with its gateway, expires stale attempts, frees abandoned slots.
// Call from a schedule (header x-cron-secret) or manually by payment staff.
import { handler, json, HttpError } from "../_shared/http.ts";
import { admin, env, requireStaff } from "../_shared/clients.ts";
import { type OrderRow, providerStatus, settle } from "../_shared/payments/service.ts";
import { safeEqual } from "../_shared/crypto.ts";

Deno.serve(handler(async (req) => {
  const cron = req.headers.get("x-cron-secret");
  if (!(cron && safeEqual(cron, env("CRON_SECRET")))) await requireStaff(req, ["PAYMENT_REVIEWER"]);
  const db = admin();
  const { data: rows } = await db.from("payment_orders").select("*").in("method_code", ["PHONEPE", "RAZORPAY"])
    .in("status", ["PENDING", "PROCESSING", "RECONCILIATION_REQUIRED", "CREATED"]).not("provider_order_id", "is", null).limit(100);
  const out = { checked: 0, success: 0, failed: 0, errors: 0 };
  for (const o of (rows ?? []) as OrderRow[]) {
    out.checked++;
    try {
      const r = await settle(db, o, await providerStatus(db, o));
      if (r.status === "SUCCESS") out.success++; else if (r.status === "FAILED") out.failed++;
      await db.from("payment_reconciliation_logs").insert({ payment_order_id: o.id, provider: o.method_code, expected_amount: o.amount, observed_status: r.status, reconciliation_status: "MATCHED", notes: "scheduled reconcile" });
    } catch (_e) { out.errors++; }
  }
  await db.rpc("expire_stale_payment_orders");
  const { data: freed } = await db.rpc("release_expired_reservations", { p_mode: null });
  return json({ ...out, released_reservations: freed ?? 0 });
}));
