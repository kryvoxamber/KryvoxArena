import { el, dt, pill, inr } from "../../ui.js";
import { shell, table, clientOrThrow, reasoned, rpc } from "./kit.js";
import { setMsg } from "../../ui.js";

export async function mount(root, { route }) {
  const isSlots = route.path === "/admin/slots";
  const w = shell(root, isSlots ? "Slot Management" : "Registration Management", isSlots ? "Mode-wise slots. Close/reopen registration ya registration cancel karke slot free karo." : "Sab registrations. Cancel/hold ke liye reason zaroori hai.");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(msg, box);
  const load = async () => {
    if (isSlots) {
      const [{ data: modes }, { data: av }] = await Promise.all([c.from("tournament_modes").select("*, tournaments(title)"), c.from("tournament_mode_availability").select("*")]);
      box.replaceChildren(table([{ h: "Tournament", f: (m) => m.tournaments.title }, { h: "Mode", f: (m) => m.mode },
        { h: "Booked", f: (m) => { const a = (av || []).find((x) => x.tournament_mode_id === m.id); return a ? `${a.booked_slots} / ${a.total_slots}` : "—"; } },
        { h: "Registration", f: (m) => pill(m.registration_closed ? "CLOSED" : "OPEN", m.registration_closed ? "bad" : "ok") },
        { h: "", f: (m) => el("button", { class: "btn sm ghost", type: "button", onclick: async () => { const { error } = await c.from("tournament_modes").update({ registration_closed: !m.registration_closed }).eq("id", m.id); setMsg(msg, error ? error.message : "Updated.", !error); load(); } }, m.registration_closed ? "Reopen" : "Close") }], modes));
      return;
    }
    const { data } = await c.from("registrations").select("*, tournaments(title), tournament_modes(mode), teams(name), registration_players(game_uid,ingame_name)").order("created_at", { ascending: false }).limit(200);
    box.replaceChildren(table([
      { h: "Booking", f: (r) => el("span", { class: "mono" }, r.booking_code) }, { h: "Tournament", f: (r) => `${r.tournaments.title} / ${r.tournament_modes.mode}` },
      { h: "Team", f: (r) => r.teams.name }, { h: "UIDs", f: (r) => r.registration_players.map((p) => p.game_uid).join(", ") },
      { h: "Amount", f: (r) => inr(r.amount) }, { h: "Status", f: (r) => pill(r.status, r.status === "CONFIRMED" ? "ok" : ["EXPIRED", "CANCELLED"].includes(r.status) ? "bad" : "warn") },
      { h: "Created", f: (r) => dt(r.created_at) },
      { h: "", f: (r) => el("div", { class: "row" },
        !["CANCELLED", "EXPIRED"].includes(r.status) ? el("button", { class: "btn sm ghost", type: "button", onclick: reasoned(msg, null, (why) => rpc("admin_set_registration_status", { p_reg: r.id, p_status: "CANCELLED", p_reason: why }), load) }, "Cancel") : null,
        r.status === "CONFIRMED" ? el("button", { class: "btn sm ghost", type: "button", onclick: reasoned(msg, null, (why) => rpc("admin_set_registration_status", { p_reg: r.id, p_status: "HELD", p_reason: why }), load) }, "Hold") : null,
        r.status === "HELD" ? el("button", { class: "btn sm ghost", type: "button", onclick: reasoned(msg, null, (why) => rpc("admin_set_registration_status", { p_reg: r.id, p_status: "CONFIRMED", p_reason: why }), load) }, "Release hold") : null) }], data));
  };
  await load();
}
