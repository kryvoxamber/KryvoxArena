import { el } from "../../ui.js";
import { shell, table, clientOrThrow, field, inp, act } from "./kit.js";
export async function mount(root) {
  const w = shell(root, "Leaderboard Management", "Leaderboard published results se automatically banta hai. Scoring rules tournament ke hisaab se.");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(msg, box);
  const load = async () => {
    const { data: ts } = await c.from("tournaments").select("id,title,scoring_rules").order("starts_at", { ascending: false });
    box.replaceChildren();
    for (const t of ts || []) {
      const pl = inp({ value: (t.scoring_rules.placement || []).join(","), placeholder: "12,9,8,7,6,5,4,3,2,1" }); const pk = inp({ type: "number", step: "0.5", value: t.scoring_rules.per_kill ?? 1 });
      box.append(el("form", { class: "form card", onsubmit: (e) => { e.preventDefault(); act(msg, async () => { const arr = pl.value.split(",").map((x) => Number(x.trim())); if (arr.some((n) => !isFinite(n) || n < 0)) throw new Error("Placement points sahi nahi hain.");
        const { error } = await c.from("tournaments").update({ scoring_rules: { placement: arr, per_kill: Number(pk.value) } }).eq("id", t.id); if (error) throw error; }); } },
        el("h3", {}, t.title), field("Placement points (1st, 2nd, … comma separated)", pl), field("Points per kill", pk), el("button", { class: "btn sm", type: "submit" }, "Save rules (naye results par lagu)")));
    }
  };
  await load();
}
