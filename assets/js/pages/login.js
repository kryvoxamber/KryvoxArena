import { el, page, setMsg, humanError, busy } from "../ui.js";
import { sb, fn } from "../supabase.js";
import { configured } from "../config.js";
import { session, myProfile } from "../auth.js";
import { navigate } from "../router.js";

export async function mount(root, { route }) {
  const isAdmin = route.path === "/admin/login";
  const { sec, wrap } = page(isAdmin ? "Admin Login" : "Login", isAdmin ? "Sirf authorised staff." : "Google se ya email OTP se sign in karo. Email verify hona zaroori hai.");
  root.append(sec);
  const q = new URLSearchParams(location.search);
  if (q.get("denied")) wrap.append(el("p", { class: "msg bad" }, "Is account ke paas admin access nahi hai."));
  if (!configured()) {
    wrap.append(el("div", { class: "banner-warn" }, "Backend abhi configure nahi hai: assets/js/config.js mein SUPABASE_URL aur SUPABASE_ANON_KEY bharo. Tab tak login kaam nahi karega (koi fake login nahi hai)."));
    return;
  }
  const next = () => { const n = q.get("next"); return n && n.startsWith("/") && !n.startsWith("//") ? n : (isAdmin ? "/admin" : "/dashboard"); };
  const card = el("div", { class: "card" }); wrap.append(card);
  const msg = el("p", { class: "msg" });

  async function after() {
    const p = await myProfile();
    if (isAdmin) return navigate("/admin");
    if (p && p.email_verified) return navigate(p.profile_completed ? next() : "/profile/setup");
    return stepVerify();
  }

  function stepStart() {
    card.replaceChildren();
    const email = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email", required: true });
    const send = el("button", { class: "btn", type: "button" }, "Email code bhejo");
    const g = el("button", { class: "btn ghost", type: "button" }, "Google se continue karo");
    g.onclick = () => busy(g, async () => {
      const c = await sb();
      const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/login" + (q.get("next") ? "?next=" + encodeURIComponent(q.get("next")) : "") } });
      if (error) setMsg(msg, humanError(error));
    });
    send.onclick = () => busy(send, async () => {
      const v = email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return setMsg(msg, "Sahi email daalo.");
      const c = await sb();
      const { error } = await c.auth.signInWithOtp({ email: v, options: { shouldCreateUser: !isAdmin } });
      if (error) return setMsg(msg, humanError(error));
      stepCode(v);
    });
    card.append(el("div", { class: "form" }, el("label", {}, "Email", email), send, el("p", { class: "lead" }, "ya"), g, msg));
  }

  function stepCode(emailAddr) {
    card.replaceChildren();
    const code = el("input", { inputmode: "numeric", maxlength: "8", placeholder: "6-digit code", autocomplete: "one-time-code" });
    const ok = el("button", { class: "btn", type: "button" }, "Verify");
    ok.onclick = () => busy(ok, async () => {
      const c = await sb();
      const { error } = await c.auth.verifyOtp({ email: emailAddr, token: code.value.trim(), type: "email" });
      if (error) return setMsg(msg, "Code galat ya expire ho gaya.");
      try { await fn("mark-verified"); } catch (e) { return setMsg(msg, humanError(e)); }
      after();
    });
    card.append(el("div", { class: "form" }, el("p", {}, `Code ${emailAddr} par bheja gaya hai.`), el("label", {}, "Code", code), ok, msg));
  }

  // Google users: our own OTP (sent through Resend by the otp-send function) proves control of the inbox.
  async function stepVerify() {
    card.replaceChildren();
    const s = await session();
    const code = el("input", { inputmode: "numeric", maxlength: "6", placeholder: "6-digit code" });
    const send = el("button", { class: "btn ghost", type: "button" }, "Code bhejo");
    const ok = el("button", { class: "btn", type: "button" }, "Verify email");
    send.onclick = () => busy(send, async () => {
      try { await fn("otp-send"); setMsg(msg, "Code bhej diya gaya hai. Inbox/spam check karo.", true); } catch (e) { setMsg(msg, humanError(e)); }
    });
    ok.onclick = () => busy(ok, async () => {
      try { await fn("otp-verify", { code: code.value.trim() }); after(); } catch (e) { setMsg(msg, humanError(e)); }
    });
    card.append(el("div", { class: "form" }, el("p", {}, `Email verify karo: ${s.user.email}`), send, el("label", {}, "Code", code), ok, msg));
  }

  const s = await session();
  if (s) await after(); else stepStart();
}
