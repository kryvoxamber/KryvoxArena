import { sb } from "./supabase.js";
import { configured } from "./config.js";

export async function session() {
  const c = await sb(); if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}
export async function myProfile() {
  const c = await sb(); const s = await session(); if (!s) return null;
  const { data } = await c.from("profiles").select("*").eq("id", s.user.id).maybeSingle();
  return data;
}
export async function myRoles() {
  const c = await sb(); const s = await session(); if (!s) return [];
  const { data } = await c.from("admin_roles").select("role").eq("user_id", s.user.id);
  return (data || []).map((r) => r.role);
}
export async function signOut() { const c = await sb(); if (c) await c.auth.signOut(); location.href = "/home"; }

// Returns {ok:true} or {ok:false, redirect}. Client-side guard only controls rendering; RLS enforces real access.
export async function guard(kind) {
  if (!kind) return { ok: true };
  if (!configured()) return { ok: false, redirect: kind === "admin" ? "/admin/login" : "/login" };
  const s = await session();
  if (!s) return { ok: false, redirect: kind === "admin" ? "/admin/login" : "/login?next=" + encodeURIComponent(location.pathname) };
  if (kind === "admin") return (await myRoles()).length ? { ok: true } : { ok: false, redirect: "/admin/login?denied=1" };
  const p = await myProfile();
  if (!p || p.status !== "ACTIVE") return { ok: false, redirect: "/login" };
  if (!p.profile_completed && location.pathname !== "/profile/setup") return { ok: false, redirect: "/profile/setup" };
  return { ok: true };
}

// Header: swap Login for account links when signed in.
export async function refreshHeader() {
  const box = document.querySelector("header .hacts"); if (!box || !configured()) return;
  const s = await session();
  box.replaceChildren();
  const a = (href, text, cls) => { const n = document.createElement("a"); n.href = href; n.textContent = text; n.className = cls; n.setAttribute("data-link", ""); return n; };
  if (s) {
    if ((await myRoles()).length) box.append(a("/admin", "Admin", "btn ghost"));
    box.append(a("/dashboard", "Dashboard", "btn ghost"));
    const out = document.createElement("button"); out.className = "btn"; out.textContent = "Logout"; out.onclick = signOut; box.append(out);
  } else { box.append(a("/login", "Login", "btn ghost"), a("/tournaments", "Register now", "btn")); }
}
