import { el, pill } from "../../ui.js";
import { shell, table, clientOrThrow, field, inp, act, reasoned, rpc } from "./kit.js";
export async function mount(root) {
  const w = shell(root, "Results Management", "Placement + kills daalo; points tournament ke scoring rules se server calculate karta hai. Publish karne par leaderboard update hota hai.");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(msg);
  const { data: ms } = await c.from("matches").select("id,title,tournament_id,status,tournaments(title)").order("scheduled_at", { ascending: false });
  const sel = el("select", { class: "inp" }, (ms || []).map((m) => el("option", { value: m.id }, `${m.tournaments.title} — ${m.title}`)));
  w.append(field("Match", sel), box);
  const load = async () => {
    box.replaceChildren(); const m = (ms || []).find((x) => x.id === sel.value); if (!m) return;
    const [{ data: regs }, { data: res }] = await Promise.all([
      c.from("registrations").select("id,teams(name)").eq("tournament_id", m.tournament_id).eq("status", "CONFIRMED"),
      c.from("match_results").select("*, registrations(teams(name))").eq("match_id", m.id).order("placement")]);
    box.append(el("div", { class: "card tblwrap" }, el("h3", {}, "Entered results"), table([{ h: "#", f: (r) => r.placement }, { h: "Team", f: (r) => r.registrations.teams.name }, { h: "Kills", f: (r) => r.kills }, { h: "Points", f: (r) => r.points }, { h: "", f: (r) => pill(r.published ? "PUBLISHED" : "DRAFT", r.published ? "ok" : "warn") }], res, "Abhi koi result nahi.")));
    const rs = el("select", { name: "r", class: "inp" }, (regs || []).map((r) => el("option", { value: r.id }, r.teams.name)));
    const f = el("form", { class: "form card" }, el("h3", {}, "Add / correct result"), field("Team", rs), field("Placement", inp({ name: "p", type: "number", min: 1, required: true })), field("Kills", inp({ name: "k", type: "number", min: 0, value: 0 })), el("button", { class: "btn", type: "submit" }, "Save"));
    f.onsubmit = (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); act(msg, () => rpc("admin_save_result", { p_match: m.id, p_registration: d.r, p_placement: Number(d.p), p_kills: Number(d.k) }), load); };
    box.append(f, el("div", { class: "row" },
      el("button", { class: "btn", type: "button", onclick: reasoned(msg, "Publish reason:", (why) => rpc("admin_publish_results", { p_match: m.id, p_publish: true, p_reason: why }), load) }, "Publish results"),
      el("button", { class: "btn ghost", type: "button", onclick: reasoned(msg, "Unpublish reason:", (why) => rpc("admin_publish_results", { p_match: m.id, p_publish: false, p_reason: why }), load) }, "Unpublish")));
  };
  sel.onchange = load; await load();
}
