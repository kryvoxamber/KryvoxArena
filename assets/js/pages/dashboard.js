import { el, page, link, inr, dt, pill, setMsg, humanError, busy } from "../ui.js";
import { sb } from "../supabase.js";
import { session } from "../auth.js";
import { mountPayment } from "../payment-flow.js";

const kind = (s) => (s === "CONFIRMED" ? "ok" : ["EXPIRED", "CANCELLED"].includes(s) ? "bad" : "warn");
const SEL = "*, tournaments(title,slug,starts_at,status), tournament_modes(mode), teams(name)";

export async function mount(root, { route }) {
  const titles = { "/dashboard": "Dashboard", "/dashboard/matches": "My Matches", "/dashboard/history": "Match History", "/dashboard/teams": "My Teams" };
  const { sec, wrap } = page(titles[route.path] || "Dashboard");
  root.append(sec);
  const c = await sb(); const s = await session();
  const { data: regs } = await c.from("registrations").select(SEL).eq("user_id", s.user.id).order("created_at", { ascending: false });
  const view = { "/dashboard": home, "/dashboard/matches": matches, "/dashboard/history": history, "/dashboard/teams": teams }[route.path];
  await view(wrap, c, s, regs || []);
}

async function home(wrap, c, s, regs) {
  const live = regs.filter((r) => ["RESERVED", "PENDING_PAYMENT"].includes(r.status) && new Date(r.reserved_until) > new Date());
  for (const r of live) {
    const box = el("div", { class: "card" }, el("h3", {}, `Payment pending: ${r.tournaments.title} (${r.tournament_modes.mode})`));
    const inner = el("div"); box.append(inner); wrap.append(box); mountPayment(inner, r.id, { onConfirmed: () => location.reload() });
  }
  const t = el("table", { class: "tbl" }, el("tr", {}, ["Tournament", "Mode", "Team", "Status", "Booking"].map((h) => el("th", {}, h))));
  for (const r of regs) t.append(el("tr", {}, el("td", {}, link(`/tournaments/${r.tournaments.slug}`, r.tournaments.title)), el("td", {}, r.tournament_modes.mode),
    el("td", {}, r.teams.name), el("td", {}, pill(r.status, kind(r.status))), el("td", { class: "mono" }, r.booking_code)));
  wrap.append(el("div", { class: "card tblwrap" }, el("h3", {}, "My registrations"), regs.length ? t : el("p", { class: "empty" }, "Abhi koi registration nahi. "), link("/tournaments", "Tournaments dekho", "btn sm")));
  const { data: ns } = await c.from("notifications").select("*").eq("user_id", s.user.id).order("created_at", { ascending: false }).limit(10);
  wrap.append(el("div", { class: "card" }, el("h3", {}, "Notifications"), (ns || []).length ? ns.map((n) => el("p", {}, el("b", {}, n.title), " — ", n.body || "", " ", el("small", {}, dt(n.created_at)))) : el("p", { class: "empty" }, "Koi notification nahi.")));
}

async function matches(wrap, c, s, regs) {
  const confirmed = regs.filter((r) => r.status === "CONFIRMED" && ["PUBLISHED", "LIVE"].includes(r.tournaments.status));
  if (!confirmed.length) return wrap.append(el("p", { class: "empty" }, "Koi confirmed upcoming match nahi."));
  for (const r of confirmed) {
    const [{ data: ms }, { data: rooms }] = await Promise.all([
      c.from("matches").select("*").eq("tournament_id", r.tournament_id).order("scheduled_at"),
      c.from("room_credentials").select("*").eq("tournament_id", r.tournament_id)]);   // RLS returns rows only for confirmed + published rooms
    wrap.append(el("div", { class: "card" }, el("h3", {}, r.tournaments.title), el("p", {}, "Start: ", dt(r.tournaments.starts_at)),
      (ms || []).map((m) => {
        const room = (rooms || []).find((x) => x.match_id === m.id);
        return el("div", {}, el("b", {}, `${m.title} — ${dt(m.scheduled_at)} `), pill(m.status),
          room ? el("p", {}, "Room ID: ", el("b", { class: "mono" }, room.room_id), " • Password: ", el("b", { class: "mono" }, room.room_password), room.instructions ? ` — ${room.instructions}` : "")
               : el("p", { class: "lead" }, "Room details match se pehle publish hongi."));
      })));
  }
}

async function history(wrap, c, s, regs) {
  const ids = regs.map((r) => r.id);
  const [{ data: res }, { data: pays }] = await Promise.all([
    ids.length ? c.from("match_results").select("*, matches(title)").in("registration_id", ids).order("match_date", { ascending: false }) : { data: [] },
    c.from("payment_orders").select("*").eq("user_id", s.user.id).order("created_at", { ascending: false })]);
  const rt = el("table", { class: "tbl" }, el("tr", {}, ["Match", "Placement", "Kills", "Points"].map((h) => el("th", {}, h))));
  for (const r of res || []) rt.append(el("tr", {}, el("td", {}, r.matches?.title), el("td", {}, `#${r.placement}`), el("td", {}, r.kills), el("td", {}, r.points)));
  wrap.append(el("div", { class: "card tblwrap" }, el("h3", {}, "Results"), (res || []).length ? rt : el("p", { class: "empty" }, "Abhi koi published result nahi.")));
  const pt = el("table", { class: "tbl" }, el("tr", {}, ["Date", "Reference", "Method", "Amount", "Status"].map((h) => el("th", {}, h))));
  for (const p of pays || []) pt.append(el("tr", {}, el("td", {}, dt(p.created_at)), el("td", { class: "mono" }, p.internal_order_reference), el("td", {}, p.method_code), el("td", {}, inr(p.amount)), el("td", {}, pill(p.status, p.status === "SUCCESS" ? "ok" : ""))));
  wrap.append(el("div", { class: "card tblwrap" }, el("h3", {}, "Payment history"), (pays || []).length ? pt : el("p", { class: "empty" }, "Koi payment nahi.")));
}

async function teams(wrap, c, s) {
  const { data: ts } = await c.from("teams").select("*, team_members(*)").eq("leader_id", s.user.id).order("created_at", { ascending: false });
  if (!ts || !ts.length) return wrap.append(el("p", { class: "empty" }, "Koi team nahi."));
  wrap.append(el("p", { class: "lead" }, "Names deadline se pehle badal sakte ho. Game UID registration ke baad lock ho jata hai; badalne ke liye support/admin se contact karo."));
  for (const t of ts) {
    const msg = el("p", { class: "msg" });
    const card = el("div", { class: "card" }, el("h3", {}, t.name));
    for (const m of t.team_members.sort((a, b) => a.position - b.position)) {
      const fn_ = el("input", { class: "inp", value: m.full_name }); const ig = el("input", { class: "inp", value: m.ingame_name });
      const b = el("button", { class: "btn sm", type: "button" }, "Save");
      b.onclick = () => busy(b, async () => {
        const { data, error } = await c.from("team_members").update({ full_name: fn_.value.trim(), ingame_name: ig.value.trim() }).eq("id", m.id).select();
        if (error || !data || !data.length) return setMsg(msg, "Edit allowed nahi hai (deadline nikal gayi ya permission nahi).");
        setMsg(msg, "Saved.", true);
      });
      card.append(el("div", { class: "row" }, el("span", {}, m.is_captain ? "Captain" : `P${m.position}`), fn_, ig, el("span", { class: "mono" }, `UID ${m.game_uid}`), b));
    }
    card.append(msg); wrap.append(card);
  }
}
