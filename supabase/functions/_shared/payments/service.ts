import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import * as razorpay from "./razorpay.ts";
import * as phonepe from "./phonepe.ts";
import { phonepeCfg, razorpayCfg } from "./config.ts";
import type { OrderRef, StatusResult } from "./types.ts";

export interface OrderRow extends OrderRef { user_id: string; booking_id: string; method_code: "PHONEPE" | "RAZORPAY" | "MANUAL_UPI"; status: string; expires_at: string; }

export async function methodEnv(db: SupabaseClient, code: string): Promise<"SANDBOX" | "PRODUCTION"> {
  const { data } = await db.from("payment_method_settings").select("environment").eq("method_code", code).single();
  return (data?.environment as "SANDBOX" | "PRODUCTION") ?? "SANDBOX";
}
// Server-to-server truth for an automatic-gateway order. The browser's claim of success is never used.
export async function providerStatus(db: SupabaseClient, o: OrderRow): Promise<StatusResult> {
  if (o.method_code === "RAZORPAY") return razorpay.fetchStatus(razorpayCfg(), o);
  if (o.method_code === "PHONEPE") return phonepe.fetchStatus(phonepeCfg(await methodEnv(db, "PHONEPE")), o);
  throw new Error("NOT_AUTOMATIC_METHOD");
}
// Apply a verified provider status to our order. SUCCESS goes through the single DB function that checks amount/currency
// and confirms the booking atomically; replays are harmless (it returns ALREADY_SUCCESS).
export async function settle(db: SupabaseClient, o: OrderRow, s: StatusResult): Promise<{ status: string; result?: string }> {
  if (s.status === "SUCCESS") {
    const { data, error } = await db.rpc("finalize_payment_success", { p_order: o.id, p_provider_txn: s.providerTxnId ?? `${o.method_code}:${o.internal_order_reference}`,
      p_amount: s.amount, p_currency: s.currency, p_provider_status: s.rawStatus, p_verified_by: null });
    if (error) throw new Error("FINALIZE_FAILED:" + error.message);
    const { data: cur } = await db.from("payment_orders").select("status").eq("id", o.id).single();
    return { status: cur?.status ?? "UNKNOWN", result: String(data) };
  }
  if (s.status === "FAILED") {
    await db.from("payment_orders").update({ status: "FAILED", provider_raw_status: s.rawStatus }).eq("id", o.id).in("status", ["CREATED", "PENDING", "PROCESSING"]);
  } else {
    await db.from("payment_orders").update({ provider_raw_status: s.rawStatus }).eq("id", o.id);
  }
  const { data: cur } = await db.from("payment_orders").select("status").eq("id", o.id).single();
  return { status: cur?.status ?? "UNKNOWN" };
}
export async function logActivity(db: SupabaseClient, provider: string, action: string, detail: Record<string, unknown>) {
  await db.from("gateway_activity_logs").insert({ provider_or_method: provider, action, new_value: detail, reason: "system" });
}
