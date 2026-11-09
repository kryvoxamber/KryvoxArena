import { el, pill } from "../../ui.js";
import { shell, table, clientOrThrow, field, inp, act } from "./kit.js";
export async function mount(root) {
  const w = shell(root, "Banner Management", "Homepage banners. Image max 5 MB (PNG/JPG/WebP).");
  const c = await clientOrThrow(); const msg = el("p", { class: "msg" }); const box = el("div"); w.append(box, msg);
  const load = async () => { const { data } = await c.from("banners").select("*").order("sort_order");
    box.replaceChildren(table([{ h: "", f: (b) => el("img", { src: c.storage.from("banners").getPublicUrl(b.image_path).data.publicUrl, alt: "", width: 120 }) }, { h: "Title", f: (b) => b.title }, { h: "Status", f: (b) => pill(b.enabled ? "ON" : "OFF", b.enabled ? "ok" : "") },
      { h: "", f: (b) => el("div", { class: "row" }, el("button", { class: "btn sm ghost", type: "button", onclick: () => act(msg, async () => { const { error } = await c.from("banners").update({ enabled: !b.enabled }).eq("id", b.id); if (error) throw error; }, load) }, b.enabled ? "Disable" : "Enable"),
        el("button", { class: "btn sm ghost", type: "button", onclick: () => window.confirm("Delete?") && act(msg, async () => { const { error } = await c.from("banners").delete().eq("id", b.id); if (error) throw error; }, load) }, "Delete")) }], data, "Koi banner nahi.")); };
  const f = el("form", { class: "form card" }, el("h3", {}, "Add banner"), field("Title", inp({ name: "t", required: true })), field("Link (optional)", inp({ name: "l" })), field("Image", inp({ name: "img", type: "file", accept: "image/png,image/jpeg,image/webp", required: true })), el("button", { class: "btn", type: "submit" }, "Upload"));
  f.onsubmit = (e) => { e.preventDefault(); act(msg, async () => { const file = f.img.files[0]; if (file.size > 5 * 1024 * 1024) throw new Error("File 5 MB se badi hai.");
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`; const up = await c.storage.from("banners").upload(path, file, { contentType: file.type }); if (up.error) throw up.error;
    const { error } = await c.from("banners").insert({ title: f.t.value, link_url: f.l.value || null, image_path: path, enabled: true }); if (error) throw error; f.reset(); }, load); };
  w.append(f); await load();
}
