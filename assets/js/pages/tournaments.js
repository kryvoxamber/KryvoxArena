import { el, page, link, inr, dt, pill } from "../ui.js";
import { sb } from "../supabase.js";
import { configured } from "../config.js";

export async function mount(root) {
  const { sec, wrap } = page("Tournaments", "Free Fire aur BGMI tournaments. Slots live count se aate hain.");
  root.append(sec);
  if (!configured()) return wrap.append(el("div", { class: "banner-warn" }, "Backend configure nahi hai, isliye tournaments load nahi ho sakte."));
  const c = await sb();
  const [{ data: ts }, { data: av }] = await Promise.all([
    c.from("tournaments").select("*").in("status", ["PUBLISHED", "LIVE", "COMPLETED"]).order("starts_at", { ascending: true }),
    c.from("tournament_mode_availability").select("*")
  ]);
  if (!ts || !ts.length) return wrap.append(el("p", { class: "empty" }, "Abhi koi tournament published nahi hai."));
  const grid = el("div", { class: "cols" });
  for (const t of ts) {
    const modes = (av || []).filter((a) => a.tournament_id === t.id);
    grid.append(el("div", { class: "card" },
      el("h3", {}, link(`/tournaments/${t.slug}`, t.title)), el("p", {}, pill(t.game.replace("_", " ")), " ", pill(t.status, t.status === "PUBLISHED" ? "ok" : "")),
      el("p", {}, "Start: ", dt(t.starts_at)),
      el("p", {}, modes.map((m) => `${m.mode}: ${m.available_slots}/${m.total_slots} slots`).join(" • ") || "—"),
      link(`/tournaments/${t.slug}`, "Details", "btn sm")));
  }
  wrap.append(grid);
}
