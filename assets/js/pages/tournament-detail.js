import { el, page, link, inr, dt, pill } from "../ui.js";
import { sb } from "../supabase.js";

export const findTournament = async (c, idOrSlug) => {
  const col = /^[0-9a-f-]{36}$/i.test(idOrSlug) ? "id" : "slug";
  const { data } = await c.from("tournaments").select("*").eq(col, idOrSlug).maybeSingle();
  return data;
};

export async function mount(root, { params }) {
  const { sec, wrap } = page("Tournament");
  root.append(sec);
  const c = await sb(); if (!c) return wrap.append(el("p", { class: "empty" }, "Backend configure nahi hai."));
  const t = await findTournament(c, params.id);
  if (!t) return wrap.append(el("p", { class: "empty" }, "Tournament nahi mila."));
  document.title = `${t.title} – Kryvox Arena`;
  wrap.querySelector("h2").textContent = t.title;
  const [{ data: modes }, { data: av }, { data: rules }, { data: matches }] = await Promise.all([
    c.from("tournament_modes").select("*").eq("tournament_id", t.id),
    c.from("tournament_mode_availability").select("*").eq("tournament_id", t.id),
    c.from("tournament_rules").select("*").eq("tournament_id", t.id).eq("published", true).order("sort_order"),
    c.from("matches").select("*").eq("tournament_id", t.id).order("scheduled_at")
  ]);
  wrap.append(el("p", { class: "lead" }, t.description || ""),
    el("dl", { class: "kv card" }, el("dt", {}, "Game"), el("dd", {}, t.game.replace("_", " ")), el("dt", {}, "Starts"), el("dd", {}, dt(t.starts_at)),
      el("dt", {}, "Registration deadline"), el("dd", {}, dt(t.registration_deadline)), el("dt", {}, "Team change deadline"), el("dd", {}, dt(t.team_change_deadline))));
  const tb = el("table", { class: "tbl" }, el("tr", {}, ["Mode", "Entry", "Prize pool", "Slots", ""].map((h) => el("th", {}, h))));
  for (const m of modes || []) {
    const a = (av || []).find((x) => x.tournament_mode_id === m.id);
    tb.append(el("tr", {}, el("td", {}, m.mode), el("td", {}, m.entry_fee > 0 ? inr(m.entry_fee) : "Free"), el("td", {}, inr(m.prize_pool)),
      el("td", {}, a ? `${a.available_slots} / ${a.total_slots}` : "—"),
      el("td", {}, a && a.registration_open ? link(`/tournaments/${t.slug}/register?mode=${m.id}`, "Register", "btn sm") : pill(a && a.is_full ? "FULL" : "CLOSED", "warn"))));
  }
  wrap.append(el("div", { class: "card tblwrap" }, el("h3", {}, "Modes"), tb));
  if (rules && rules.length) wrap.append(el("div", { class: "card" }, el("h3", {}, "Rules"), rules.map((r) => el("div", {}, el("b", {}, r.title), el("p", {}, r.body)))));
  if (matches && matches.length) wrap.append(el("div", { class: "card" }, el("h3", {}, "Schedule"), matches.map((m) => el("p", {}, `${dt(m.scheduled_at)} — ${m.title}`))));
}
