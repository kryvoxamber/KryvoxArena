import { el, pill } from "../../ui.js";
import { shell, clientOrThrow, field, inp, act, ask, rpc } from "./kit.js";
import { CONFIG } from "../../config.js";

const SECRETS = { PHONEPE: ["PHONEPE_CLIENT_ID", "PHONEPE_CLIENT_SECRET", "PHONEPE_CLIENT_VERSION", "PHONEPE_WEBHOOK_USERNAME", "PHONEPE_WEBHOOK_PASSWORD"], RAZORPAY: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"], MANUAL_UPI: [] };
export async function mount(root) {
  const w = shell(root, "Payment Methods & Gateways", "Paid entry compliance gate ke bina ON nahi ho sakti. Secrets yahan kabhi save nahi hote — Supabase Edge Function secrets mein rakho.");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(msg, box);
  const load = async () => {
    const [{ data: g }, { data: ms }] = await Promise.all([c.from("payment_global_settings").select("*").single(), c.from("payment_method_settings").select("*").order("method_code")]);
    box.replaceChildren();
    const gate = el("form", { class: "form card" }, el("h3", {}, "Global payment & compliance gate"),
      g.compliance_status !== "APPROVED" ? el("div", { class: "banner-warn" }, "Compliance APPROVED nahi hai: paid entry aur saare payment methods locked hain. Free tournaments chalte rehte hain.") : null,
      el("p", {}, "Compliance: ", pill(g.compliance_status, g.compliance_status === "APPROVED" ? "ok" : "bad"), g.compliance_reviewer ? ` reviewer: ${g.compliance_reviewer}` : ""),
      field("Compliance status", el("select", { name: "cs", class: "inp" }, ["NOT_APPROVED", "APPROVED"].map((s) => el("option", { value: s, selected: s === g.compliance_status }, s)))),
      field("Compliance reviewer (legal/compliance owner, required for APPROVED)", inp({ name: "rv", value: g.compliance_reviewer || "" })),
      field("Compliance note", inp({ name: "nt", value: g.compliance_note || "" })),
      el("label", {}, el("input", { type: "checkbox", name: "paid", checked: g.paid_entry_enabled }), " Paid entry enabled"),
      el("label", {}, el("input", { type: "checkbox", name: "free", checked: g.free_entry_enabled }), " Free entry enabled"),
      field("Attempt expiry (minutes)", inp({ name: "exp", type: "number", min: 5, max: 180, value: g.attempt_expiry_minutes })),
      field("Min amount ₹", inp({ name: "min", type: "number", step: "0.01", value: g.min_amount ?? "" })), field("Max amount ₹", inp({ name: "max", type: "number", step: "0.01", value: g.max_amount ?? "" })),
      field("Refund policy text (players ko dikhta hai)", el("textarea", { name: "rf", class: "inp", rows: 3 }, g.refund_policy_text || "")),
      field("Support contact", inp({ name: "sc", value: g.support_contact || "" })),
      field("Maintenance message", inp({ name: "mm", value: g.maintenance_message || "" })),
      el("button", { class: "btn", type: "submit" }, "Save global settings"));
    gate.onsubmit = (e) => { e.preventDefault(); const d = new FormData(gate); const why = ask("Reason (audit log):"); if (!why) return;
      const num = (v) => (v === "" || v == null ? null : Number(v));
      act(msg, () => rpc("admin_update_payment_global", { p_reason: why, p_patch: { compliance_status: d.get("cs"), compliance_reviewer: d.get("rv"), compliance_note: d.get("nt"), paid_entry_enabled: d.get("paid") === "on", free_entry_enabled: d.get("free") === "on",
        attempt_expiry_minutes: Number(d.get("exp")), min_amount: num(d.get("min")), max_amount: num(d.get("max")), refund_policy_text: d.get("rf"), support_contact: d.get("sc"), maintenance_message: d.get("mm") } }), load); };
    box.append(gate);
    for (const m of ms) {
      const cfg = m.config_public || {};
      const f = el("form", { class: "form card" }, el("h3", {}, `${m.display_name} (${m.method_code})`),
        el("p", {}, pill(m.enabled ? "ENABLED" : "DISABLED", m.enabled ? "ok" : ""), " ", pill(`Approval: ${m.compliance_approval_status}`, m.compliance_approval_status === "APPROVED" ? "ok" : "bad"), m.is_primary_automatic ? " " : "", m.is_primary_automatic ? pill("PRIMARY AUTOMATIC", "ok") : ""),
        field("Display name", inp({ name: "dn", value: m.display_name })),
        field("Approval status", el("select", { name: "ap", class: "inp" }, ["NOT_APPROVED", "APPROVED"].map((s) => el("option", { value: s, selected: s === m.compliance_approval_status }, s)))),
        m.method_code !== "MANUAL_UPI" ? field("Environment", el("select", { name: "env", class: "inp" }, ["SANDBOX", "PRODUCTION"].map((s) => el("option", { value: s, selected: s === m.environment }, s)))) : null,
        m.method_code === "MANUAL_UPI" ? el("div", { class: "form" }, field("UPI ID (VPA)", inp({ name: "vpa", value: cfg.upi_id || "" })), field("Payee name", inp({ name: "payee", value: cfg.payee_name || "" })), field("QR image path in 'payment-assets' bucket", inp({ name: "qr", value: cfg.qr_path || "" }))) : null,
        field("Player-facing instructions", el("textarea", { name: "ins", class: "inp", rows: 2 }, m.public_instructions || "")),
        m.method_code !== "MANUAL_UPI" ? el("label", {}, el("input", { type: "checkbox", name: "prim", checked: m.is_primary_automatic }), " Primary automatic gateway") : null,
        el("label", {}, el("input", { type: "checkbox", name: "en", checked: m.enabled }), " Enabled (sirf APPROVED + global compliance ke saath)"),
        SECRETS[m.method_code].length ? el("p", { class: "lead" }, "Required secrets (Supabase → Edge Functions → Secrets): ", el("span", { class: "mono" }, SECRETS[m.method_code].join(", "))) : null,
        m.method_code !== "MANUAL_UPI" ? el("p", { class: "lead" }, "Webhook URL: ", el("span", { class: "mono" }, `${CONFIG.SUPABASE_URL}/functions/v1/${m.method_code === "PHONEPE" ? "phonepe-webhook" : "razorpay-webhook"}`)) : null,
        el("button", { class: "btn", type: "submit" }, "Save"));
      f.onsubmit = (e) => { e.preventDefault(); const d = new FormData(f); const why = ask("Reason (audit log):"); if (!why) return;
        const patch = { display_name: d.get("dn"), compliance_approval_status: d.get("ap"), public_instructions: d.get("ins"), enabled: d.get("en") === "on" };
        if (m.method_code !== "MANUAL_UPI") { patch.environment = d.get("env"); if (d.get("prim") === "on") patch.is_primary_automatic = true; }
        else patch.config_public = { upi_id: d.get("vpa"), payee_name: d.get("payee"), qr_path: d.get("qr") };
        act(msg, () => rpc("admin_update_payment_method", { p_method: m.method_code, p_patch: patch, p_reason: why }), load); };
      box.append(f);
    }
    const { data: logs } = await c.from("gateway_activity_logs").select("*").order("created_at", { ascending: false }).limit(15);
    box.append(el("div", { class: "card" }, el("h3", {}, "Recent gateway activity"), ...(logs || []).map((l) => el("p", {}, `${new Date(l.created_at).toLocaleString("en-IN")} — ${l.provider_or_method}: ${l.action}${l.reason ? " — " + l.reason : ""}`))));
  };
  await load();
}
