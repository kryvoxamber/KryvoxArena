import { el, page, link, inr, dt, setMsg, humanError, busy } from "../ui.js";
import { sb, rpc } from "../supabase.js";
import { myProfile } from "../auth.js";
import { findTournament } from "./tournament-detail.js";
import { mountPayment } from "../payment-flow.js";
import { navigate } from "../router.js";

export async function mount(root, { params }) {
  const { sec, wrap } = page("Registration");
  root.append(sec);
  const c = await sb(); const t = await findTournament(c, params.id);
  if (!t) return wrap.append(el("p", { class: "empty" }, "Tournament nahi mila."));
  wrap.querySelector("h2").textContent = `Register: ${t.title}`;
  const [{ data: modes }, { data: av }] = await Promise.all([
    c.from("tournament_modes").select("*").eq("tournament_id", t.id), c.from("tournament_mode_availability").select("*").eq("tournament_id", t.id)]);
  const open = (modes || []).filter((m) => (av || []).find((a) => a.tournament_mode_id === m.id && a.registration_open));
  if (!open.length) return wrap.append(el("p", { class: "empty" }, "Is tournament mein abhi registration open nahi hai ya slots full hain."));
  const p = await myProfile();
  const want = new URLSearchParams(location.search).get("mode");
  const mode = el("select", {}, open.map((m) => el("option", { value: m.id, selected: m.id === want }, `${m.mode} — ${m.entry_fee > 0 ? inr(m.entry_fee) : "Free"}`)));
  const team = el("input", { required: true, maxlength: 40, placeholder: "Team name" });
  const email = el("input", { type: "email", required: true, value: p.email || "" });
  const phone = el("input", { type: "tel", required: true, value: p.phone || "" });
  const country = el("input", { required: true, value: p.country || "" }); const state = el("input", { required: true, value: p.state || "" });
  const playersBox = el("div", { class: "form" });
  const msg = el("p", { class: "msg" });
  const btn = el("button", { class: "btn", type: "submit" }, "Slot book karo");
  const payBox = el("div", { class: "card", hidden: true });

  const drawPlayers = () => {
    const m = open.find((x) => x.id === mode.value); playersBox.replaceChildren();
    for (let i = 1; i <= m.team_size; i++) playersBox.append(el("fieldset", { class: "card" }, el("legend", {}, i === 1 ? "Captain (you)" : `Player ${i}`),
      el("label", {}, "Full name", el("input", { name: `n${i}`, required: true, maxlength: 80, value: i === 1 ? p.full_name || "" : "" })),
      el("label", {}, "In-game name", el("input", { name: `g${i}`, required: true, maxlength: 40 })),
      el("label", {}, "Game UID", el("input", { name: `u${i}`, required: true, inputmode: "numeric", pattern: "[0-9]{6,15}", placeholder: "6-15 digits" }))));
  };
  mode.onchange = drawPlayers; drawPlayers();

  const form = el("form", { class: "form" }, el("label", {}, "Mode", mode), el("label", {}, "Team name", team), playersBox,
    el("label", {}, "Contact email", email), el("label", {}, "Contact phone", phone), el("label", {}, "Country", country), el("label", {}, "State", state), btn, msg);
  wrap.append(form, payBox);
  form.onsubmit = (e) => { e.preventDefault(); busy(btn, async () => {
    const m = open.find((x) => x.id === mode.value); const fd = new FormData(form);
    const players = Array.from({ length: m.team_size }, (_, k) => ({ full_name: fd.get(`n${k + 1}`), ingame_name: fd.get(`g${k + 1}`), game_uid: fd.get(`u${k + 1}`) }));
    try {
      const regId = await rpc("book_slot", { p_mode_id: m.id, p_team_name: team.value, p_country: country.value, p_state: state.value,
        p_contact_email: email.value, p_contact_phone: phone.value, p_players: players });
      form.hidden = true; payBox.hidden = false;
      await mountPayment(payBox, regId, { onConfirmed: () => navigate("/dashboard") });
      if (m.entry_fee == 0) { setTimeout(() => navigate("/dashboard"), 1500); }
    } catch (err) { setMsg(msg, humanError(err)); }
  }); };
}
