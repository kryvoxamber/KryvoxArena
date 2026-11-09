import { el, dt, pill } from "../../ui.js";
import { shell, table, clientOrThrow, field, inp, act } from "./kit.js";
export async function mount(root) {
  const w = shell(root, "Match Scheduling");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(box, msg);
  const { data: ts } = await c.from("tournaments").select("id,title").order("starts_at", { ascending: false });
  const load = async () => {
    const { data } = await c.from("matches").select("*, tournaments(title)").order("scheduled_at", { ascending: false });
    box.replaceChildren(table([{ h: "Tournament", f: (m) => m.tournaments.title }, { h: "Match", f: (m) => m.title }, { h: "When", f: (m) => dt(m.scheduled_at) }, { h: "Status", f: (m) => pill(m.status) },
      { h: "", f: (m) => el("select", { class: "inp", onchange: (e) => act(msg, async () => { const { error } = await c.from("matches").update({ status: e.target.value }).eq("id", m.id); if (error) throw error; }, load) },
        ["SCHEDULED", "LIVE", "COMPLETED", "CANCELLED", "POSTPONED"].map((s) => el("option", { value: s, selected: s === m.status }, s))) }], data));
  };
  const f = el("form", { class: "form card" }, el("h3", {}, "Add match"),
    field("Tournament", el("select", { name: "t", class: "inp", required: true }, (ts || []).map((t) => el("option", { value: t.id }, t.title)))),
    field("Title", inp({ name: "title", required: true, placeholder: "Match 1" })), field("Round", inp({ name: "round", type: "number", min: 1, value: 1 })),
    field("Scheduled at", inp({ name: "at", type: "datetime-local", required: true })), el("button", { class: "btn", type: "submit" }, "Add"));
  f.onsubmit = (e) => { e.preventDefault(); act(msg, async () => { const d = Object.fromEntries(new FormData(f));
    const { error } = await c.from("matches").insert({ tournament_id: d.t, title: d.title, round_no: Number(d.round), scheduled_at: new Date(d.at).toISOString() }); if (error) throw error; f.reset(); }, load); };
  w.append(f); await load();
}
