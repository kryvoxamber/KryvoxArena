import { el, dt, pill } from "../../ui.js";
import { shell, table, clientOrThrow, field, inp, act, ask, rpc } from "./kit.js";
export async function mount(root, { route }) {
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div");
  if (route.path === "/admin/audit-logs") {
    const w = shell(root, "Audit Logs", "Append-only: edit ya delete database level par blocked hai."); w.append(box);
    const { data } = await c.from("admin_audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
    return box.append(table([{ h: "When", f: (r) => dt(r.created_at) }, { h: "Actor", f: (r) => el("span", { class: "mono" }, String(r.actor_id || "").slice(0, 8)) }, { h: "Action", f: (r) => r.action }, { h: "Entity", f: (r) => `${r.entity} ${String(r.entity_id || "").slice(0, 8)}` }, { h: "Reason", f: (r) => r.reason || "" }], data));
  }
  if (route.path === "/admin/staff") {
    const w = shell(root, "Staff Permissions", "Sirf SUPER_ADMIN roles de/hata sakta hai. Last SUPER_ADMIN hataya nahi ja sakta."); w.append(msg, box);
    const ROLES = ["SUPER_ADMIN", "TOURNAMENT_MANAGER", "RESULT_MANAGER", "SUPPORT_MANAGER", "EMAIL_MANAGER", "PAYMENT_REVIEWER"];
    const load = async () => { const { data } = await c.from("admin_roles").select("*, profiles:user_id(email,full_name)").order("created_at");
      box.replaceChildren(table([{ h: "Staff", f: (r) => r.profiles?.email }, { h: "Role", f: (r) => pill(r.role) }, { h: "", f: (r) => el("button", { class: "btn sm ghost", type: "button", onclick: async () => { const why = ask("Reason:"); if (why) await act(msg, () => rpc("admin_set_role", { p_email: r.profiles.email, p_role: r.role, p_grant: false, p_reason: why }), load); } }, "Revoke") }], data));
      const f = el("form", { class: "form card" }, el("h3", {}, "Grant role (user pehle ek baar login kar chuka ho)"), field("Email", inp({ name: "e", type: "email", required: true })), field("Role", el("select", { name: "r", class: "inp" }, ROLES.map((r) => el("option", { value: r }, r)))), el("button", { class: "btn", type: "submit" }, "Grant"));
      f.onsubmit = (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const why = ask("Reason:"); if (why) act(msg, () => rpc("admin_set_role", { p_email: d.e, p_role: d.r, p_grant: true, p_reason: why }), load); };
      box.append(f); };
    return load();
  }
  const w = shell(root, "User Management", "Suspend/ban ke liye reason zaroori hai."); w.append(msg, box);
  const load = async () => { const { data } = await c.from("profiles").select("*").order("created_at", { ascending: false }).limit(200);
    box.replaceChildren(table([{ h: "Name", f: (u) => u.full_name || "—" }, { h: "Email", f: (u) => u.email }, { h: "Verified", f: (u) => pill(u.email_verified ? "YES" : "NO", u.email_verified ? "ok" : "warn") }, { h: "Status", f: (u) => pill(u.status, u.status === "ACTIVE" ? "ok" : "bad") }, { h: "Joined", f: (u) => dt(u.created_at) },
      { h: "", f: (u) => el("div", { class: "row" }, ...["ACTIVE", "SUSPENDED", "BANNED"].filter((s) => s !== u.status).map((s) => el("button", { class: "btn sm ghost", type: "button", onclick: async () => { const why = ask("Reason:"); if (why) await act(msg, () => rpc("admin_set_user_status", { p_user: u.id, p_status: s, p_reason: why }), load); } }, s))) }], data)); };
  await load();
}
