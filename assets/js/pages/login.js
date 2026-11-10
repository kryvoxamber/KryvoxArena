import { el, page, setMsg, humanError, busy } from "../ui.js";
import { sb } from "../supabase.js";
import { configured } from "../config.js";
import { session, myProfile, myRoles } from "../auth.js";
import { navigate } from "../router.js";

// Plain login: email + password, or Google. No OTP step.
export async function mount(root, { route }) {
  const isAdmin = route.path === "/admin/login";
  const { sec, wrap } = page(isAdmin ? "Admin Login" : "Login", isAdmin ? "Sirf authorised staff." : "Email + password se ya Google se login karo.");
  root.append(sec);
  const q = new URLSearchParams(location.search);
  if (q.get("denied")) wrap.append(el("p", { class: "msg bad" }, "Is account ke paas admin access nahi hai."));
  if (!configured()) {
    wrap.append(el("div", { class: "banner-warn" }, "Backend abhi configure nahi hai: SUPABASE_URL aur SUPABASE_ANON_KEY set karo. Tab tak login kaam nahi karega (koi fake login nahi hai)."));
    return;
  }
  const next = () => { const n = q.get("next"); return n && n.startsWith("/") && !n.startsWith("//") ? n : (isAdmin ? "/admin" : "/dashboard"); };
  const card = el("div", { class: "card" }); wrap.append(card);
  const msg = el("p", { class: "msg" });
  let mode = "login";

  async function after() {
    if (isAdmin) {
      if (!(await myRoles()).length) return navigate("/admin/login?denied=1");
      return navigate("/admin");
    }
    const p = await myProfile();
    return navigate(p && p.profile_completed ? next() : "/profile/setup");
  }

  function draw() {
    card.replaceChildren();
    const email = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email", required: true });
    const pass = el("input", { type: "password", placeholder: "Password (min 8)", autocomplete: mode === "login" ? "current-password" : "new-password", required: true, minlength: 8 });
    const go = el("button", { class: "btn", type: "submit" }, mode === "login" ? "Login" : "Account banao");
    const form = el("form", { class: "form" }, el("label", {}, "Email", email), el("label", {}, "Password", pass), go, msg);
    form.onsubmit = (e) => { e.preventDefault(); busy(go, async () => {
      const c = await sb(); const v = email.value.trim();
      if (mode === "login") {
        const { error } = await c.auth.signInWithPassword({ email: v, password: pass.value });
        if (error) return setMsg(msg, /confirm/i.test(error.message) ? "Pehle email mein aaya confirmation link kholo." : "Email ya password galat hai.");
        return after();
      }
      const { data, error } = await c.auth.signUp({ email: v, password: pass.value, options: { emailRedirectTo: location.origin + "/login" } });
      if (error) return setMsg(msg, /registered|exists/i.test(error.message) ? "Is email se account pehle se hai. Login karo." : humanError(error));
      if (data.session) return after();
      setMsg(msg, "Account ban gaya. Email mein confirmation link bheja gaya hai, use kholo phir login karo.", true);
    }); };
    card.append(form);
    if (!isAdmin) {
      const g = el("button", { class: "btn ghost", type: "button" }, "Google se continue karo");
      g.onclick = () => busy(g, async () => {
        const c = await sb();
        const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/login" + (q.get("next") ? "?next=" + encodeURIComponent(q.get("next")) : "") } });
        if (error) setMsg(msg, humanError(error));
      });
      const forgot = el("button", { class: "btn sm ghost", type: "button" }, "Password bhool gaye?");
      forgot.onclick = () => busy(forgot, async () => {
        const v = email.value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return setMsg(msg, "Pehle upar email daalo.");
        const c = await sb(); const { error } = await c.auth.resetPasswordForEmail(v, { redirectTo: location.origin + "/login" });
        setMsg(msg, error ? humanError(error) : "Reset link email par bhej diya gaya hai.", !error);
      });
      const sw = el("button", { class: "btn sm ghost", type: "button" }, mode === "login" ? "Naya account banao" : "Pehle se account hai? Login");
      sw.onclick = () => { mode = mode === "login" ? "signup" : "login"; setMsg(msg, ""); draw(); };
      card.append(el("div", { class: "row", style: "margin-top:14px" }, g, sw, mode === "login" ? forgot : null));
    }
  }
  draw();
  if (await session()) await after();
}
