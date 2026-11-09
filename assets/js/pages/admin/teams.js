import { el } from "../../ui.js";
import { shell, table, clientOrThrow, ask, act, rpc } from "./kit.js";
export async function mount(root) {
  const w = shell(root, "Team Management", "Players ke UID lock hote hain. Yahan se audited override kar sakte ho (reason zaroori).");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(msg, box);
  const load = async () => {
    const { data } = await c.from("teams").select("*, team_members(*)").order("created_at", { ascending: false }).limit(200);
    box.replaceChildren(table([{ h: "Team", f: (t) => t.name }, { h: "Members", f: (t) => el("div", {}, ...t.team_members.sort((a, b) => a.position - b.position).map((m) =>
      el("div", { class: "row" }, el("span", {}, `${m.full_name} (${m.ingame_name}) `), el("span", { class: "mono" }, m.game_uid),
        el("button", { class: "btn sm ghost", type: "button", onclick: async () => { const uid = ask("New game UID (6-15 digits):"); if (!uid) return; const why = ask("Reason:"); if (!why) return;
          await act(msg, () => rpc("admin_edit_team_member", { p_member: m.id, p_patch: { game_uid: uid }, p_reason: why }), load); } }, "Change UID")))) }], data));
  };
  await load();
}
