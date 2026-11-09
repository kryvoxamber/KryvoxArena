import { el, inr } from "../../ui.js";
import { shell, clientOrThrow } from "./kit.js";
export async function mount(root) {
  const w = shell(root, "Admin Dashboard", "Live counts database se.");
  const c = await clientOrThrow();
  const n = async (q) => (await q).count ?? 0;
  const [t, regs, pend, users, rev, recon] = await Promise.all([
    n(c.from("tournaments").select("id", { count: "exact", head: true }).in("status", ["PUBLISHED", "LIVE"])),
    n(c.from("registrations").select("id", { count: "exact", head: true }).eq("status", "CONFIRMED")),
    n(c.from("manual_upi_submissions").select("id", { count: "exact", head: true }).eq("review_status", "PENDING")),
    n(c.from("profiles").select("id", { count: "exact", head: true })),
    c.from("payment_transactions").select("amount"),
    n(c.from("payment_orders").select("id", { count: "exact", head: true }).eq("status", "RECONCILIATION_REQUIRED"))]);
  const sum = (rev.data || []).reduce((a, r) => a + Number(r.amount), 0);
  const card = (k, v, warn) => el("div", { class: "card" }, el("p", { class: "lead" }, k), el("h3", { style: warn ? "color:#ffc857" : "" }, String(v)));
  w.append(el("div", { class: "cols" }, card("Live tournaments", t), card("Confirmed registrations", regs), card("Manual UPI pending review", pend, pend > 0),
    card("Needs reconciliation", recon, recon > 0), card("Players", users), card("Verified collections", inr(sum))));
}
