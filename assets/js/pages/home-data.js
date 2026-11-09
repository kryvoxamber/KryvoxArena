// Loads LIVE data for the homepage (no demo values). Returns empty collections when the backend is not configured
// or nothing is published, and the page's own "empty" messages are shown.
import { sb } from "../supabase.js";
import { configured } from "../config.js";

export async function loadLive() {
  const out = { start: null, game: "—", mode: "", telegram: "#", instagram: "kryvoxarena", admin: "#", notice: "", modes: [], matches: [], winners: [], leaderboard: [], split: [60, 25, 15], cut: 0, hasData: false };
  if (!configured()) return out;
  try {
    const c = await sb();
    const [{ data: ts }, { data: av }, { data: modes }, { data: st }, { data: ann }, { data: lb }] = await Promise.all([
      c.from("tournaments").select("id,slug,title,game,starts_at,status").in("status", ["PUBLISHED", "LIVE"]).gte("starts_at", new Date(Date.now() - 3 * 3600e3).toISOString()).order("starts_at").limit(12),
      c.from("tournament_mode_availability").select("*"),
      c.from("tournament_modes").select("*"),
      c.from("site_settings").select("key,value").in("key", ["social"]),
      c.from("announcements").select("title,body").eq("published", true).eq("pinned", true).limit(1),
      c.from("leaderboard_entries").select("team_name,points,kills").eq("scope", "OVERALL").order("points", { ascending: false }).limit(10)
    ]);
    const social = ((st || []).find((x) => x.key === "social") || {}).value || {};
    if (social.telegram) out.telegram = social.telegram;
    if (social.instagram) out.instagram = String(social.instagram).replace(/^@/, "");
    if (social.admin) out.admin = social.admin;
    if (ann && ann[0]) out.notice = ann[0].title;
    out.leaderboard = (lb || []).map((r) => ({ team: r.team_name, points: r.points, kills: r.kills }));
    if (ts && ts.length) {
      out.hasData = true;
      const t0 = ts[0]; out.start = new Date(t0.starts_at); out.game = t0.game === "BGMI" ? "BGMI" : "Free Fire";
      const m0 = (modes || []).filter((m) => m.tournament_id === t0.id);
      out.mode = m0.length ? m0[m0.length - 1].mode.charAt(0) + m0[m0.length - 1].mode.slice(1).toLowerCase() : "";
      out.modes = m0.map((m) => ({ name: m.mode.charAt(0) + m.mode.slice(1).toLowerCase(), players: m.team_size, fee: Number(m.entry_fee), slotCount: m.total_slots,
        unit: m.team_size === 1 ? "players" : m.team_size === 2 ? "duos" : "squads", pay: `/tournaments/${t0.slug}/register?mode=${m.id}`, bonus: Number(m.most_kills_bonus),
        prize: Number(m.prize_pool), breakdown: Array.isArray(m.prize_breakdown) ? m.prize_breakdown.map(Number) : [] }));
      for (const t of ts) for (const m of (modes || []).filter((x) => x.tournament_id === t.id)) {
        const a = (av || []).find((x) => x.tournament_mode_id === m.id);
        out.matches.push({ game: t.game === "BGMI" ? "BGMI" : "Free Fire", mode: m.mode.charAt(0) + m.mode.slice(1).toLowerCase(), date: t.starts_at, slots: a ? `${a.booked_slots}/${a.total_slots}` : `0/${m.total_slots}`, slug: t.slug, modeId: m.id });
      }
    }
  } catch (e) { console.error("home data", e); }
  return out;
}
