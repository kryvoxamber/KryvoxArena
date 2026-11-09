import { el, dt, inr, pill } from "../../ui.js";
import { shell, clientOrThrow, ask, act, rpc } from "./kit.js";
export async function mount(root) {
  const w = shell(root, "Manual UPI Review Queue", "Approve karne se pehle apne bank/UPI statement mein asli credit (amount + UTR) verify karo. Screenshot akela proof nahi hai.");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(msg, box);
  const load = async () => {
    const { data } = await c.from("manual_upi_submissions").select("*, payment_orders(internal_order_reference,amount), profiles(full_name,email)").in("review_status", ["PENDING", "NEEDS_CLARIFICATION"]).order("submitted_at");
    box.replaceChildren(); if (!data || !data.length) return box.append(el("p", { class: "empty" }, "Queue khaali hai."));
    for (const s of data) {
      const card = el("div", { class: "card" }, el("h3", {}, `${s.payment_orders.internal_order_reference} — ${inr(s.payment_orders.amount)}`),
        el("dl", { class: "kv" }, el("dt", {}, "Player"), el("dd", {}, `${s.profiles?.full_name || ""} (${s.profiles?.email || ""})`), el("dt", {}, "UTR"), el("dd", { class: "mono" }, s.utr_reference),
          el("dt", {}, "Payer name"), el("dd", {}, s.payer_display_name || "—"), el("dt", {}, "Submitted"), el("dd", {}, dt(s.submitted_at)), el("dt", {}, "Status"), el("dd", {}, pill(s.review_status, "warn"))));
      if (s.proof_storage_path) {
        const { data: u } = await c.storage.from("payment-proofs").createSignedUrl(s.proof_storage_path, 300);
        if (u) card.append(el("a", { href: u.signedUrl, target: "_blank", rel: "noopener noreferrer" }, "Proof dekho (5 min link)"));
      }
      const chk = el("input", { type: "checkbox" });
      card.append(el("label", {}, chk, ` Maine bank/UPI statement mein ${inr(s.payment_orders.amount)} ka credit, UTR ${s.utr_reference} ke saath, khud dekha hai.`),
        el("div", { class: "row" },
          el("button", { class: "btn", type: "button", onclick: async () => { if (!chk.checked) return (msg.textContent = "Pehle credit verify karke checkbox tick karo."); const why = ask("Approval note:"); if (why) await act(msg, () => rpc("review_manual_upi", { p_submission: s.id, p_decision: "APPROVE", p_reason: why, p_credit_verified: true }), load); } }, "Approve"),
          el("button", { class: "btn ghost", type: "button", onclick: async () => { const why = ask("Reject reason (player ko dikhega):"); if (why) await act(msg, () => rpc("review_manual_upi", { p_submission: s.id, p_decision: "REJECT", p_reason: why, p_credit_verified: false }), load); } }, "Reject"),
          el("button", { class: "btn ghost", type: "button", onclick: async () => { const why = ask("Kya clarification chahiye?"); if (why) await act(msg, () => rpc("review_manual_upi", { p_submission: s.id, p_decision: "CLARIFY", p_reason: why, p_credit_verified: false }), load); } }, "Ask clarification")));
      box.append(card);
    }
  };
  await load();
}
