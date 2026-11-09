import { el, pill } from "../../ui.js";
import { shell, table, clientOrThrow, field, inp, act } from "./kit.js";
import { fn } from "../../supabase.js";
export async function mount(root) {
  const w = shell(root, "Room Management", "Room ID/password sirf CONFIRMED players ko dikhta hai, aur sirf PUBLISHED hone par. Password list mein chhupa rehta hai.");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(box, msg);
  const [{ data: ts }, { data: ms }] = await Promise.all([c.from("tournaments").select("id,title"), c.from("matches").select("id,title,tournament_id")]);
  const load = async () => {
    const { data } = await c.from("room_credentials").select("*, tournaments(title), matches(title)").neq("status", "REMOVED").order("created_at", { ascending: false });
    box.replaceChildren(table([{ h: "Tournament", f: (r) => r.tournaments.title }, { h: "Match", f: (r) => r.matches?.title || "—" }, { h: "Room ID", f: (r) => el("span", { class: "mono" }, r.room_id) },
      { h: "Status", f: (r) => pill(`${r.status} v${r.version}`, r.status === "PUBLISHED" ? "ok" : "") },
      { h: "", f: (r) => el("div", { class: "row" },
        r.status !== "PUBLISHED" ? el("button", { class: "btn sm", type: "button", onclick: () => act(msg, async () => { const { error } = await c.from("room_credentials").update({ status: "PUBLISHED" }).eq("id", r.id); if (error) throw error; }, load) }, "Publish") : el("button", { class: "btn sm ghost", type: "button", onclick: () => act(msg, async () => { const { error } = await c.from("room_credentials").update({ status: "HIDDEN" }).eq("id", r.id); if (error) throw error; }, load) }, "Hide"),
        r.status === "PUBLISHED" ? el("button", { class: "btn sm ghost", type: "button", onclick: () => act(msg, async () => { const o = await fn("email-enqueue", { kind: r.version > 1 ? "ROOM_DETAILS_UPDATE" : "ROOM_DETAILS", tournament_id: r.tournament_id, room_id: r.id, batch_id: `room-${r.id}-v${r.version}`, subject: `Room details: ${r.tournaments.title}` }); msg.textContent = `${o.queued} email queued.`; }) }, "Email players") : null,
        el("button", { class: "btn sm ghost", type: "button", onclick: () => act(msg, async () => { const id = window.prompt("New room ID:", r.room_id); const pw = id && window.prompt("New password:"); if (!id || !pw) return; const { error } = await c.from("room_credentials").update({ room_id: id, room_password: pw }).eq("id", r.id); if (error) throw error; }, load) }, "Edit")) }], data));
  };
  const tSel = el("select", { name: "t", class: "inp", required: true }, (ts || []).map((t) => el("option", { value: t.id }, t.title)));
  const mSel = el("select", { name: "m", class: "inp" });
  const fill = () => { mSel.replaceChildren(el("option", { value: "" }, "(whole tournament)"), ...(ms || []).filter((m) => m.tournament_id === tSel.value).map((m) => el("option", { value: m.id }, m.title))); };
  tSel.onchange = fill; fill();
  const f = el("form", { class: "form card" }, el("h3", {}, "Add room (DRAFT)"), field("Tournament", tSel), field("Match", mSel), field("Room ID", inp({ name: "rid", required: true })), field("Password", inp({ name: "pw", required: true })), field("Instructions", inp({ name: "ins" })), el("button", { class: "btn", type: "submit" }, "Save draft"));
  f.onsubmit = (e) => { e.preventDefault(); act(msg, async () => { const d = Object.fromEntries(new FormData(f));
    const { error } = await c.from("room_credentials").insert({ tournament_id: d.t, match_id: d.m || null, room_id: d.rid.trim(), room_password: d.pw.trim(), instructions: d.ins || null }); if (error) throw error; f.reset(); fill(); }, load); };
  w.append(f); await load();
}
