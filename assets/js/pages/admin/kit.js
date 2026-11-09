import { el, setMsg, humanError } from "../../ui.js";
import { sb, rpc } from "../../supabase.js";
export const shell = (root, title, lead) => { const w = el("div", { class: "admin-page" }, el("h2", {}, title), lead ? el("p", { class: "lead" }, lead) : null); root.append(w); return w; };
export const table = (cols, rows, empty = "Koi data nahi.") => {
  if (!rows || !rows.length) return el("p", { class: "empty" }, empty);
  const t = el("table", { class: "tbl" }, el("tr", {}, cols.map((c) => el("th", {}, c.h))));
  for (const r of rows) t.append(el("tr", {}, cols.map((c) => el("td", {}, c.f(r)))));
  return el("div", { class: "tblwrap" }, t);
};
export const ask = (q) => { const v = window.prompt(q); return v && v.trim() ? v.trim() : null; };
export async function act(msg, fn, reload) {
  try { await fn(); setMsg(msg, "Done.", true); if (reload) await reload(); } catch (e) { setMsg(msg, humanError(e)); }
}
export const reasoned = (msg, label, fn, reload) => async () => { const r = ask(label || "Reason (required, audit log mein jayega):"); if (r) await act(msg, () => fn(r), reload); };
export const field = (label, input) => el("label", {}, label, input);
export const inp = (attrs = {}) => el("input", { class: "inp", ...attrs });
export const clientOrThrow = async () => { const c = await sb(); if (!c) throw new Error("Backend configure nahi hai."); return c; };
export { rpc };
