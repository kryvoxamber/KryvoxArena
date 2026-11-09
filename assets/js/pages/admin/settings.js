import { el } from "../../ui.js";
import { shell, clientOrThrow, field, act } from "./kit.js";
// Free-form JSON values for known keys: social {telegram, instagram, admin}, support {email, whatsapp}, rules_text {text}.
const KEYS = { social: '{"telegram":"https://t.me/…","instagram":"handle","admin":"https://t.me/…"}', support: '{"email":"","whatsapp":""}', rules_text: '{"text":"Rules yahan likho"}' };
export async function mount(root) {
  const w = shell(root, "Website Settings", "Homepage links, support aur rules content. JSON format; save se pehle validate hota hai.");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); w.append(msg);
  const { data } = await c.from("site_settings").select("*");
  for (const k of Object.keys(KEYS)) {
    const cur = (data || []).find((r) => r.key === k);
    const ta = el("textarea", { class: "inp mono", rows: 5 }, JSON.stringify(cur ? cur.value : JSON.parse(KEYS[k]), null, 2));
    w.append(el("form", { class: "form card", onsubmit: (e) => { e.preventDefault(); act(msg, async () => { const v = JSON.parse(ta.value); if (typeof v !== "object" || v === null) throw new Error("Object chahiye.");
      const { error } = await c.from("site_settings").upsert({ key: k, value: v, is_public: true }); if (error) throw error; }); } }, el("h3", {}, k), ta, el("button", { class: "btn sm", type: "submit" }, "Save")));
  }
}
