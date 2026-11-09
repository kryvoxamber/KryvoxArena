import { el, dt, inr, pill } from "../../ui.js";
import { shell, table, clientOrThrow, ask, act, rpc } from "./kit.js";
import { fn } from "../../supabase.js";
export async function mount(root) {
  const w = shell(root, "Payment Management", "Orders, verified transactions, reconciliation aur refunds. Success sirf server-verified payments ko milta hai.");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(msg, box);
  const load = async () => {
    const [{ data: o }, { data: tx }, { data: rec }, { data: rf }] = await Promise.all([
      c.from("payment_orders").select("*").order("created_at", { ascending: false }).limit(100),
      c.from("payment_transactions").select("*, payment_orders(internal_order_reference)").order("created_at", { ascending: false }).limit(100),
      c.from("payment_reconciliation_logs").select("*").order("created_at", { ascending: false }).limit(50),
      c.from("refund_records").select("*").order("created_at", { ascending: false }).limit(50)]);
    box.replaceChildren(
      el("div", { class: "row" }, el("button", { class: "btn", type: "button", onclick: () => act(msg, async () => { const r = await fn("payment-reconcile"); msg.textContent = `Checked ${r.checked}, success ${r.success}, failed ${r.failed}, errors ${r.errors}, released ${r.released_reservations}`; }, load) }, "Run reconciliation now")),
      el("div", { class: "card" }, el("h3", {}, "Orders"), table([{ h: "Ref", f: (r) => el("span", { class: "mono" }, r.internal_order_reference) }, { h: "Method", f: (r) => r.method_code }, { h: "Amount", f: (r) => inr(r.amount) },
        { h: "Status", f: (r) => pill(r.status, r.status === "SUCCESS" ? "ok" : r.status === "RECONCILIATION_REQUIRED" ? "bad" : "warn") }, { h: "Created", f: (r) => dt(r.created_at) }], o)),
      el("div", { class: "card" }, el("h3", {}, "Verified transactions"), table([{ h: "Order", f: (t) => t.payment_orders?.internal_order_reference }, { h: "Provider txn", f: (t) => el("span", { class: "mono" }, t.provider_transaction_id) }, { h: "Amount", f: (t) => inr(t.amount) }, { h: "When", f: (t) => dt(t.verified_at) },
        { h: "", f: (t) => el("button", { class: "btn sm ghost", type: "button", onclick: async () => { const ref = ask("Refund reference (provider/bank ref):"); if (!ref) return; const amt = Number(ask(`Amount (max ${t.amount}):`)); const why = ask("Reason:"); if (!amt || !why) return;
          await act(msg, () => rpc("admin_record_refund", { p_txn: t.id, p_reference: ref, p_amount: amt, p_reason: why }), load); } }, "Record refund") }], tx)),
      el("div", { class: "card" }, el("h3", {}, "Refunds"), table([{ h: "Ref", f: (r) => r.refund_reference }, { h: "Amount", f: (r) => inr(r.amount) }, { h: "Status", f: (r) => pill(r.status, r.status === "SUCCESS" ? "ok" : "warn") }, { h: "Reason", f: (r) => r.reason },
        { h: "", f: (r) => r.status === "PENDING" ? el("button", { class: "btn sm", type: "button", onclick: async () => { if (!window.confirm("Kya refund provider/bank statement mein independently verify ho chuka hai?")) return; const why = ask("Note:"); if (why) await act(msg, () => rpc("admin_complete_refund", { p_refund: r.id, p_independently_verified: true, p_reason: why }), load); } }, "Mark verified & complete") : null }], rf)),
      el("div", { class: "card" }, el("h3", {}, "Reconciliation log"), table([{ h: "When", f: (r) => dt(r.created_at) }, { h: "Provider", f: (r) => r.provider }, { h: "Result", f: (r) => r.reconciliation_status }, { h: "Notes", f: (r) => r.notes }], rec)));
  };
  await load();
}
