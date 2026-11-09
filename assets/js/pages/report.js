import { el, setMsg, humanError, busy } from "../ui.js";
import { sb } from "../supabase.js";
import { session } from "../auth.js";

export async function reportForm() {
  const s = await session();
  if (!s) return el("div", { class: "card" }, el("p", {}, "Report karne ke liye login karo."));
  const c = await sb();
  const uid = el("input", { placeholder: "Reported player's game UID (optional)", inputmode: "numeric" });
  const k = el("select", {}, ["CHEATING", "ABUSE", "PAYMENT_ISSUE", "OTHER"].map((x) => el("option", { value: x }, x)));
  const d = el("textarea", { required: true, rows: 4, maxlength: 1000, placeholder: "Kya hua?" });
  const msg = el("p", { class: "msg" }); const b = el("button", { class: "btn", type: "submit" }, "Report bhejo");
  const f = el("form", { class: "form card" }, el("h3", {}, "Report"), el("label", {}, "Type", k), uid, el("label", {}, "Details", d), b, msg);
  f.onsubmit = (e) => { e.preventDefault(); busy(b, async () => {
    const { error } = await c.from("user_reports").insert({ reporter_id: s.user.id, against_uid: uid.value.trim() || null, kind: k.value, details: d.value.trim() });
    if (error) return setMsg(msg, humanError(error)); setMsg(msg, "Report mil gaya.", true); f.reset();
  }); };
  return f;
}
