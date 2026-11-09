import { el, dt, pill } from "../../ui.js";
import { shell, table, clientOrThrow, field, inp, act } from "./kit.js";
import { fn } from "../../supabase.js";
export async function mount(root) {
  const w = shell(root, "Email Notifications", "Emails Resend se jaate hain; queue + retry + log. Resend configure nahi hai to emails FAIL dikhenge (koi fake success nahi).");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(msg);
  const { data: ts } = await c.from("tournaments").select("id,title").order("starts_at", { ascending: false });
  const f = el("form", { class: "form card" }, el("h3", {}, "Broadcast to confirmed players"),
    field("Tournament", el("select", { name: "t", class: "inp", required: true }, (ts || []).map((t) => el("option", { value: t.id }, t.title)))),
    field("Type", el("select", { name: "k", class: "inp" }, ["CUSTOM", "MATCH_REMINDER", "MATCH_STARTING", "TOURNAMENT_POSTPONED", "TOURNAMENT_CANCELLED", "WINNER_ANNOUNCEMENT"].map((k) => el("option", { value: k }, k)))),
    field("Subject", inp({ name: "s", required: true, maxlength: 150 })), field("Message", el("textarea", { name: "m", class: "inp", rows: 4, maxlength: 3000 })),
    el("button", { class: "btn", type: "submit" }, "Queue emails"));
  f.onsubmit = (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); act(msg, async () => { const r = await fn("email-enqueue", { kind: d.k, tournament_id: d.t, subject: d.s, message: d.m }); msg.textContent = `${r.queued} emails queued. "Process queue" dabao.`; }, load); };
  w.append(f, el("div", { class: "row" }, el("button", { class: "btn", type: "button", onclick: () => act(msg, async () => { const r = await fn("email-worker"); msg.textContent = `Sent ${r.sent}, retry ${r.retry}, failed ${r.failed}`; }, load) }, "Process queue now")), box);
  async function load() {
    const [{ data: q }, { data: l }] = await Promise.all([c.from("email_queue").select("*").order("created_at", { ascending: false }).limit(40), c.from("email_logs").select("*").order("created_at", { ascending: false }).limit(40)]);
    box.replaceChildren(el("div", { class: "card" }, el("h3", {}, "Queue"), table([{ h: "To", f: (r) => r.to_email }, { h: "Template", f: (r) => r.template }, { h: "Status", f: (r) => pill(r.status, r.status === "SENT" ? "ok" : r.status === "FAILED" ? "bad" : "warn") }, { h: "Tries", f: (r) => r.attempts }, { h: "Created", f: (r) => dt(r.created_at) }], q)),
      el("div", { class: "card" }, el("h3", {}, "Delivery log"), table([{ h: "When", f: (r) => dt(r.created_at) }, { h: "To", f: (r) => r.to_email }, { h: "Template", f: (r) => r.template }, { h: "Result", f: (r) => pill(r.status, r.status === "SENT" ? "ok" : "bad") }, { h: "Error", f: (r) => r.error || "" }], l)));
  }
  await load();
}
