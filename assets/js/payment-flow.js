// Player-side payment UI. The browser NEVER decides that a payment succeeded: it only shows what the server
// (Edge Functions + DB) reports. Card/UPI PIN/OTP are never collected here; gateways collect them on their own pages.
import { el, inr, setMsg, humanError, busy, pill, dt } from "./ui.js";
import { sb, fn, rpc } from "./supabase.js";

const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Script load failed")); document.head.append(s);
});

export async function mountPayment(box, registrationId, { onConfirmed } = {}) {
  const c = await sb();
  const { data: reg } = await c.from("registrations").select("id,status,amount,reserved_until,booking_code").eq("id", registrationId).single();
  box.replaceChildren();
  if (!reg) return box.append(el("p", { class: "msg bad" }, "Booking nahi mili."));
  if (reg.status === "CONFIRMED") return box.append(el("p", { class: "msg ok" }, `Slot confirmed. Booking code: ${reg.booking_code}`));
  if (!["RESERVED", "PENDING_PAYMENT"].includes(reg.status)) return box.append(el("p", { class: "msg bad" }, `Booking status: ${reg.status}`));

  const msg = el("p", { class: "msg" });
  const { data: orders } = await c.from("payment_orders").select("*").eq("booking_id", reg.id).order("created_at", { ascending: false });
  const active = (orders || []).find((o) => ["CREATED", "PENDING", "PROCESSING", "PAYMENT_UNDER_REVIEW", "RECONCILIATION_REQUIRED"].includes(o.status));

  box.append(el("h3", {}, `Payment: ${inr(reg.amount)}`),
    el("p", { class: "lead" }, `Slot ${dt(reg.reserved_until)} tak reserved hai.`));

  if (active) return showActive(box, active, reg, msg, onConfirmed);

  const methods = await rpc("list_payment_methods");
  if (!methods || !methods.length) {
    box.append(el("div", { class: "banner-warn" }, "Abhi koi payment method available nahi hai. Admin ne paid entry enable nahi ki hai."));
    return;
  }
  const list = el("div", { class: "row" });
  for (const m of methods) {
    const b = el("button", { class: "btn" + (m.is_primary_automatic ? "" : " ghost"), type: "button" }, m.display_name);
    b.onclick = () => busy(b, async () => {
      try { const out = await fn("payment-create", { registration_id: reg.id, method: m.method_code, idempotency_key: crypto.randomUUID() });
            await handleCreated(box, out, reg, onConfirmed); } catch (e) { setMsg(msg, humanError(e)); }
    });
    list.append(b);
    if (m.public_instructions) list.append(el("small", {}, m.public_instructions));
  }
  box.append(list, msg);
}

async function handleCreated(box, out, reg, onConfirmed) {
  if (out.redirect_url) { location.href = out.redirect_url; return; }          // PhonePe hosted page
  if (out.razorpay) {                                                          // Razorpay Checkout
    await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    const rz = new window.Razorpay({
      key: out.razorpay.key_id, order_id: out.razorpay.order_id, amount: out.razorpay.amount, currency: "INR", name: "Kryvox Arena",
      handler: async (resp) => { await verifyLoop(box, out.order_id, { razorpay: resp }, reg, onConfirmed); },
      modal: { ondismiss: () => mountPayment(box, reg.id, { onConfirmed }) }
    });
    rz.open(); return;
  }
  return mountPayment(box, reg.id, { onConfirmed });                          // manual UPI: shows the active order
}

async function verifyLoop(box, orderId, extra, reg, onConfirmed) {
  box.replaceChildren(el("p", {}, "Payment server se verify ho raha hai…"));
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fn("payment-verify", { order_id: orderId, ...extra });
      if (r.status === "SUCCESS") { await mountPayment(box, reg.id, { onConfirmed }); if (onConfirmed) onConfirmed(); return; }
      if (["FAILED", "EXPIRED", "CANCELLED", "REJECTED"].includes(r.status)) break;
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  mountPayment(box, reg.id, { onConfirmed });
}

function showActive(box, o, reg, msg, onConfirmed) {
  box.append(el("p", {}, "Order: ", el("span", { class: "mono" }, o.internal_order_reference), " ", pill(o.status, o.status === "PAYMENT_UNDER_REVIEW" ? "warn" : "")));
  if (o.status === "PAYMENT_UNDER_REVIEW") { box.append(el("p", {}, "Payment admin review mein hai. Verify hote hi slot confirm ho jayega.")); return; }
  if (o.status === "RECONCILIATION_REQUIRED") { box.append(el("p", { class: "msg bad" }, "Payment verification pending hai. Dobara payment mat karo — support se contact karo.")); return; }
  if (o.method_code === "MANUAL_UPI") return manualForm(box, o, reg, msg);
  const chk = el("button", { class: "btn ghost", type: "button" }, "Status check karo");
  chk.onclick = () => busy(chk, () => verifyLoop(box, o.id, {}, reg, onConfirmed));
  box.append(el("p", {}, "Payment gateway par pending hai. Agar pay kar diya hai to status check karo."), chk, msg);
}

async function manualForm(box, o, reg, msg) {
  let info; try { info = await fn("payment-create", { registration_id: reg.id, method: "MANUAL_UPI", order_id: o.id }); } catch (e) { box.append(el("p", { class: "msg bad" }, humanError(e))); return; }
  const u = info.upi || {};
  const uri = u.vpa ? `upi://pay?pa=${encodeURIComponent(u.vpa)}&pn=${encodeURIComponent(u.payee_name || "")}&am=${o.amount}&cu=INR&tn=${encodeURIComponent(o.internal_order_reference)}` : null;
  box.append(el("div", { class: "card" },
    el("p", {}, `Exactly ${inr(o.amount)} bhejo. Note/remark mein ye likho: `, el("b", { class: "mono" }, o.internal_order_reference)),
    u.vpa ? el("p", {}, "UPI ID: ", el("b", { class: "mono" }, u.vpa), u.payee_name ? ` (${u.payee_name})` : "") : null,
    uri ? el("a", { class: "btn sm", href: uri }, "UPI app mein kholo") : null,
    u.qr_url ? el("img", { src: u.qr_url, alt: "UPI QR", width: 200, height: 200, style: "display:block;margin-top:10px;background:#fff;padding:6px;border-radius:8px" }) : null,
    info.instructions ? el("p", { class: "lead" }, info.instructions) : null,
    el("p", { class: "lead" }, "Payment ke baad UTR/reference number yahan daalo. Admin bank credit dekh kar verify karega; tab tak slot confirm nahi hota.")));
  const utr = el("input", { required: true, minlength: 8, maxlength: 30, pattern: "[A-Za-z0-9]{8,30}", placeholder: "UTR / Ref no." });
  const payer = el("input", { placeholder: "Payer name (optional)" });
  const proof = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,application/pdf" });
  const form = el("form", { class: "form" }, el("label", {}, "UTR / Reference", utr), el("label", {}, "Payer name", payer), el("label", {}, "Screenshot (optional, max 5 MB)", proof));
  const btn = el("button", { class: "btn", type: "submit" }, "Submit for review"); form.append(btn, msg); box.append(form);
  form.onsubmit = (e) => { e.preventDefault(); busy(btn, async () => {
    try {
      const c = await sb(); const { data: s } = await c.auth.getSession(); let path = null;
      const f = proof.files[0];
      if (f) {
        if (f.size > 5 * 1024 * 1024) return setMsg(msg, "File 5 MB se chhoti honi chahiye.");
        path = `${s.session.user.id}/${o.id}-${Date.now()}`;
        const up = await c.storage.from("payment-proofs").upload(path, f, { contentType: f.type });
        if (up.error) return setMsg(msg, "Proof upload nahi hua.");
      }
      await fn("manual-upi-submit", { order_id: o.id, utr: utr.value.trim(), payer_name: payer.value.trim() || null, paid_at: new Date().toISOString(), proof_path: path });
      mountPayment(box, reg.id);
    } catch (e2) { setMsg(msg, humanError(e2)); }
  }); };
}
