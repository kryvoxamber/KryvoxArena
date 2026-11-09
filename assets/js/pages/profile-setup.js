import { el, page, setMsg, humanError, busy } from "../ui.js";
import { sb } from "../supabase.js";
import { myProfile, session } from "../auth.js";
import { navigate } from "../router.js";

// Shared by /profile/setup and /settings. Only the columns the DB grants (name, phone, location, avatar) are sent.
export async function mount(root, { route }) {
  const setup = route.path === "/profile/setup";
  const { sec, wrap } = page(setup ? "Profile complete karo" : "Profile Settings", setup ? "Tournament register karne se pehle ye details zaroori hain." : "Apni details update karo.");
  root.append(sec);
  const c = await sb(); const s = await session(); const p = (await myProfile()) || {};
  const f = (k, label, type = "text", extra = {}) => el("label", {}, label, el("input", { name: k, type, value: p[k] || "", ...extra }));
  const form = el("form", { class: "form card" },
    f("full_name", "Full name", "text", { required: true, maxlength: 80 }),
    el("label", {}, "Email (verified)", el("input", { value: p.email || s.user.email, disabled: true })),
    f("phone", "Phone (+91…)", "tel", { required: true, pattern: "\\+?[0-9]{8,15}", placeholder: "+919876543210" }),
    f("country", "Country", "text", { required: true }), f("state", "State", "text", { required: true }), f("city", "City"),
    el("label", {}, "Profile picture", el("input", { name: "avatar", type: "file", accept: "image/png,image/jpeg,image/webp" }),
      el("small", {}, "Max 2 MB. PNG / JPG / WebP.")));
  const msg = el("p", { class: "msg" });
  const btn = el("button", { class: "btn", type: "submit" }, "Save");
  form.append(btn, msg); wrap.append(form);
  form.onsubmit = (e) => { e.preventDefault(); busy(btn, async () => {
    const d = Object.fromEntries(new FormData(form));
    const patch = { full_name: d.full_name.trim(), phone: d.phone.trim(), country: d.country.trim(), state: d.state.trim(), city: (d.city || "").trim() || null };
    const file = form.avatar.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) return setMsg(msg, "Image 2 MB se chhoti honi chahiye.");
      const path = `${s.user.id}/avatar-${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;
      const up = await c.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: true });
      if (up.error) return setMsg(msg, "Image upload nahi hui.");
      patch.avatar_url = c.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }
    const { error } = await c.from("profiles").update(patch).eq("id", s.user.id);
    if (error) return setMsg(msg, /phone/.test(error.message) ? "Ye phone number kisi aur account par hai ya galat hai." : humanError(error));
    setMsg(msg, "Saved.", true);
    if (setup) navigate(new URLSearchParams(location.search).get("next") || "/dashboard");
  }); };
}
