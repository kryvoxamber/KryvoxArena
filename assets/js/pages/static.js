import { el, page, link } from "../ui.js";
import { sb } from "../supabase.js";

export async function mount(root, { route }) {
  if (route.path === "/rules") {
    const { sec, wrap } = page("Tournament Rules", "Fair play, payout aur dispute rules.");
    root.append(sec);
    const c = await sb();
    const { data } = c ? await c.from("site_settings").select("value").eq("key", "rules_text").maybeSingle() : { data: null };
    wrap.append(el("div", { class: "card" }, data && data.value && data.value.text ? el("p", { style: "white-space:pre-wrap" }, data.value.text)
      : el("p", { class: "empty" }, "Admin ne abhi rules publish nahi kiye (Admin → Website Settings → rules_text).")),
      el("div", { class: "card" }, el("h3", {}, "Payments"), el("p", {}, "Slot sirf verified payment ke baad confirm hota hai. Refund policy payment page par dikhayi jaati hai.")));
    return;
  }
  const { sec, wrap } = page("Contact & Support", "Koi problem ho to admin se contact karo ya kisi player ko report karo.");
  root.append(sec);
  const c = await sb();
  const { data } = c ? await c.from("site_settings").select("value").eq("key", "support").maybeSingle() : { data: null };
  const v = (data && data.value) || {};
  wrap.append(el("div", { class: "card" }, el("h3", {}, "Contact"),
    v.email ? el("p", {}, "Email: ", el("a", { href: `mailto:${v.email}` }, v.email)) : null,
    v.whatsapp ? el("p", {}, "WhatsApp: ", el("a", { href: v.whatsapp, rel: "noopener" }, v.whatsapp)) : null,
    !v.email && !v.whatsapp ? el("p", { class: "empty" }, "Support contact abhi set nahi hai (Admin → Website Settings → support).") : null));
  const { reportForm } = await import("./report.js");
  wrap.append(await reportForm());
}
