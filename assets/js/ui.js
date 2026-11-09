// Tiny DOM helpers. All dynamic text goes through textContent / el() so user data can never inject HTML.
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}
export const link = (href, text, cls = "") => el("a", { href, "data-link": true, class: cls }, text);
export const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
export const dt = (s) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const pill = (text, kind = "") => el("span", { class: "pill " + kind }, text);

const ERRORS = {
  NOT_AUTHENTICATED: "Pehle login karo.", PROFILE_NOT_VERIFIED: "Email verify aur profile complete karo.",
  REGISTRATION_CLOSED: "Registration band hai.", REGISTRATION_NOT_OPEN: "Registration abhi shuru nahi hui.",
  DEADLINE_PASSED: "Registration deadline nikal chuki hai.", SLOTS_FULL: "Slots full ho gaye.",
  WRONG_TEAM_SIZE: "Team size is mode ke liye galat hai.", INVALID_UID: "Game UID 6-15 digits ka hona chahiye.",
  DUPLICATE_UID_IN_TEAM: "Team mein same UID do baar hai.", UID_ALREADY_REGISTERED: "Is tournament mein ek UID pehle se registered hai.",
  ALREADY_REGISTERED: "Tum is tournament mein pehle se registered ho.", TEAM_NAME_TAKEN: "Team name pehle se liya hua hai.",
  PAID_ENTRY_DISABLED: "Paid entry abhi band hai.", FREE_ENTRY_DISABLED: "Free entry abhi band hai.",
  INVALID_PHONE: "Phone number sahi nahi hai.", INVALID_EMAIL: "Email sahi nahi hai.",
  ACTIVE_ATTEMPT_EXISTS: "Ek payment attempt pehle se chal raha hai. Uska status check karo.",
  METHOD_UNAVAILABLE: "Ye payment method abhi available nahi hai.", RESERVATION_EXPIRED: "Slot reservation expire ho gaya.",
  UTR_ALREADY_SUBMITTED: "Ye UTR pehle se submit ho chuka hai.", RATE_LIMITED: "Bahut zyada attempts. Thodi der baad try karo.",
  FORBIDDEN: "Is action ki permission nahi hai.", CONFLICT_OF_INTEREST: "Apna khud ka payment review nahi kar sakte.",
  CREDIT_NOT_VERIFIED: "Bank credit verify kiye bina approve nahi ho sakta.", REASON_REQUIRED: "Reason likhna zaroori hai.",
  COMPLIANCE_NOT_APPROVED: "Compliance approval ke bina enable nahi ho sakta."
};
export function humanError(e) {
  const m = String((e && (e.message || e.error)) || e || "");
  for (const k of Object.keys(ERRORS)) if (m.includes(k)) return ERRORS[k];
  return m && m.length < 160 ? m : "Kuch galat ho gaya. Dobara try karo.";
}
export function setMsg(node, text, ok = false) { node.textContent = text || ""; node.className = "msg " + (text ? (ok ? "ok" : "bad") : ""); }
export function page(title, lead) {
  const sec = el("section", { class: "page" });
  const wrap = el("div", { class: "wrap" }, el("h2", {}, title), lead ? el("p", { class: "lead" }, lead) : null);
  sec.append(wrap);
  return { sec, wrap };
}
export async function busy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}
