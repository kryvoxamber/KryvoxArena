import { el, page, pill } from "../ui.js";
import { sb } from "../supabase.js";
import { configured } from "../config.js";

export async function mount(root) {
  const { sec, wrap } = page("Leaderboard", "Sirf published results se. Tournament, game aur mode ke hisaab se filter karo.");
  root.append(sec);
  if (!configured()) return wrap.append(el("div", { class: "banner-warn" }, "Backend configure nahi hai."));
  const c = await sb();
  const { data: ts } = await c.from("tournaments").select("id,title").in("status", ["PUBLISHED", "LIVE", "COMPLETED"]).order("starts_at", { ascending: false });
  const scope = el("select", { class: "inp" }, el("option", { value: "OVERALL" }, "Overall"), ...(ts || []).map((t) => el("option", { value: t.id }, t.title)));
  const game = el("select", { class: "inp" }, ["", "FREE_FIRE", "BGMI"].map((g) => el("option", { value: g }, g || "All games")));
  const mode = el("select", { class: "inp" }, ["", "SOLO", "DUO", "SQUAD"].map((g) => el("option", { value: g }, g || "All modes")));
  const box = el("div", { class: "card tblwrap" });
  wrap.append(el("div", { class: "row" }, scope, game, mode), box);
  const load = async () => {
    let q = c.from("leaderboard_entries").select("*").order("points", { ascending: false }).order("kills", { ascending: false }).limit(100);
    q = scope.value === "OVERALL" ? q.eq("scope", "OVERALL") : q.eq("scope", "TOURNAMENT").eq("tournament_id", scope.value);
    if (game.value) q = q.eq("game", game.value); if (mode.value) q = q.eq("mode", mode.value);
    const { data } = await q; box.replaceChildren();
    if (!data || !data.length) return box.append(el("p", { class: "empty" }, "Is filter mein abhi koi published result nahi."));
    const t = el("table", { class: "tbl" }, el("tr", {}, ["#", "Team", "Game / Mode", "State", "Matches", "Wins", "Kills", "Points"].map((h) => el("th", {}, h))));
    data.forEach((r, i) => t.append(el("tr", {}, el("td", {}, i + 1), el("td", {}, r.team_name), el("td", {}, `${r.game} / ${r.mode}`), el("td", {}, r.state || "—"), el("td", {}, r.matches_played), el("td", {}, r.wins), el("td", {}, r.kills), el("td", {}, r.points))));
    box.append(t);
  };
  [scope, game, mode].forEach((s) => (s.onchange = load)); await load();
}
