import { el, dt, pill, inr } from "../../ui.js";
import { shell, table, clientOrThrow, field, inp, act, ask } from "./kit.js";
import { el as _e, setMsg } from "../../ui.js";

export async function mount(root) {
  const w = shell(root, "Tournament Management", "Create tournament, modes aur status. Draft tab tak public ko nahi dikhta.");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" });
  const list = el("div"); w.append(list, msg);
  const load = async () => {
    const { data: ts } = await c.from("tournaments").select("*, tournament_modes(*)").order("starts_at", { ascending: false });
    list.replaceChildren(table([
      { h: "Title", f: (t) => t.title }, { h: "Game", f: (t) => t.game }, { h: "Status", f: (t) => pill(t.status, t.status === "PUBLISHED" ? "ok" : "") },
      { h: "Starts", f: (t) => dt(t.starts_at) },
      { h: "Modes", f: (t) => (t.tournament_modes || []).map((m) => `${m.mode} ${m.total_slots}× ${m.entry_fee > 0 ? inr(m.entry_fee) : "Free"}`).join(", ") },
      { h: "Actions", f: (t) => el("div", { class: "row" },
          ...["DRAFT", "PUBLISHED", "LIVE", "COMPLETED", "CANCELLED", "POSTPONED"].filter((s) => s !== t.status).map((s) =>
            el("button", { class: "btn sm ghost", type: "button", onclick: () => act(msg, async () => { const { error } = await c.from("tournaments").update({ status: s }).eq("id", t.id); if (error) throw error; }, load) }, s))) }
    ], ts, "Abhi koi tournament nahi."));
  };
  const f = el("form", { class: "form card" }, el("h3", {}, "New tournament"),
    field("Title", inp({ name: "title", required: true })), field("Slug (url)", inp({ name: "slug", required: true, pattern: "[a-z0-9-]+" })),
    field("Game", el("select", { name: "game", class: "inp" }, el("option", { value: "FREE_FIRE" }, "Free Fire"), el("option", { value: "BGMI" }, "BGMI"))),
    field("Description", el("textarea", { name: "description", class: "inp", rows: 3 })),
    field("Starts at", inp({ name: "starts_at", type: "datetime-local", required: true })),
    field("Registration deadline", inp({ name: "registration_deadline", type: "datetime-local", required: true })),
    field("Team change deadline", inp({ name: "team_change_deadline", type: "datetime-local", required: true })),
    el("h3", {}, "Modes (slots 0 = mode add mat karo)"),
    ...["SOLO", "DUO", "SQUAD"].map((m) => el("fieldset", { class: "card" }, el("legend", {}, m),
      field("Slots", inp({ name: `${m}_slots`, type: "number", min: 0, value: 0 })), field("Entry fee ₹ (0 = free)", inp({ name: `${m}_fee`, type: "number", min: 0, step: "0.01", value: 0 })),
      field("Prize pool ₹", inp({ name: `${m}_prize`, type: "number", min: 0, step: "0.01", value: 0 })), field("Most-kills bonus ₹", inp({ name: `${m}_bonus`, type: "number", min: 0, step: "0.01", value: 0 })))),
    el("button", { class: "btn", type: "submit" }, "Create (DRAFT)"));
  f.onsubmit = (e) => { e.preventDefault(); act(msg, async () => {
    const d = Object.fromEntries(new FormData(f)); const iso = (v) => new Date(v).toISOString();
    const { data: t, error } = await c.from("tournaments").insert({ title: d.title.trim(), slug: d.slug.trim(), game: d.game, description: d.description, status: "DRAFT",
      starts_at: iso(d.starts_at), registration_deadline: iso(d.registration_deadline), team_change_deadline: iso(d.team_change_deadline) }).select().single();
    if (error) throw error;
    const size = { SOLO: 1, DUO: 2, SQUAD: 4 };
    const modes = ["SOLO", "DUO", "SQUAD"].filter((m) => Number(d[`${m}_slots`]) > 0).map((m) => ({ tournament_id: t.id, mode: m, team_size: size[m], total_slots: Number(d[`${m}_slots`]),
      entry_fee: Number(d[`${m}_fee`]), prize_pool: Number(d[`${m}_prize`]), most_kills_bonus: Number(d[`${m}_bonus`]) }));
    if (modes.length) { const r = await c.from("tournament_modes").insert(modes); if (r.error) throw r.error; }
    f.reset();
  }, load); };
  w.append(f); await load();
}
