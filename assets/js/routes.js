// Route table. `stage` = development stage (see README) that replaces the placeholder view with the real page.
// `auth`: null = public, "player" = signed-in + verified player, "admin" = staff (enforced server-side via RLS/Edge Functions;
// the client guard only controls what is rendered and is never a security boundary).
export const PLAYER_NAV = [
  ["/dashboard", "Dashboard"], ["/dashboard/teams", "My Teams"], ["/dashboard/matches", "My Matches"],
  ["/dashboard/history", "Match History"], ["/settings", "Profile Settings"]
];

export const ADMIN_NAV = [
  ["/admin", "Dashboard"], ["/admin/tournaments", "Tournaments"], ["/admin/registrations", "Registrations"],
  ["/admin/teams", "Teams"], ["/admin/slots", "Slots"], ["/admin/payments", "Payments"],
  ["/admin/payment-methods", "Payment Methods & Gateways"], ["/admin/manual-upi", "Manual UPI Review"],
  ["/admin/rooms", "Rooms"], ["/admin/matches", "Match Schedule"], ["/admin/results", "Results"],
  ["/admin/leaderboard", "Leaderboard"], ["/admin/emails", "Email Notifications"], ["/admin/banners", "Banners"],
  ["/admin/users", "Users"], ["/admin/staff", "Staff Permissions"], ["/admin/audit-logs", "Audit Logs"],
  ["/admin/settings", "Website Settings"]
];

const s = (path, title, stage, auth, layout, desc) => ({ path, title, stage, auth, layout, desc, view: "stub" });

export const ROUTES = [
  { path: "/home", title: "Kryvox Arena – Free Fire & BGMI Tournaments", layout: "site", auth: null, view: "home" },

  { path: "/login", title: "Login", layout: "site", auth: null, view: "login" },
  { path: "/profile/setup", title: "Complete your player profile", layout: "site", auth: "player", view: "profile-setup" },
  { path: "/tournaments", title: "Tournaments", layout: "site", auth: null, view: "tournaments" },
  { path: "/tournaments/:id", title: "Tournament details", layout: "site", auth: null, view: "tournament-detail" },
  { path: "/tournaments/:id/register", title: "Tournament registration", layout: "site", auth: "player", view: "register" },
  { path: "/dashboard", title: "Player dashboard", layout: "player", auth: "player", view: "dashboard" },
  { path: "/dashboard/teams", title: "My Teams", layout: "player", auth: "player", view: "dashboard" },
  { path: "/dashboard/matches", title: "My Matches", layout: "player", auth: "player", view: "dashboard" },
  { path: "/dashboard/history", title: "Match History", layout: "player", auth: "player", view: "dashboard" },
  { path: "/leaderboard", title: "Leaderboard", layout: "site", auth: null, view: "leaderboard" },
  { path: "/settings", title: "Profile Settings", layout: "player", auth: "player", view: "profile-setup" },
  { path: "/rules", title: "Tournament Rules", layout: "site", auth: null, view: "static" },
  { path: "/support", title: "Contact & Support", layout: "site", auth: null, view: "static" },

  { path: "/admin/login", title: "Admin Login", layout: "bare", auth: null, view: "login" },
  { path: "/admin", title: "Admin Dashboard", layout: "admin", auth: "admin", view: "admin/dashboard" },
  { path: "/admin/tournaments", title: "Tournament Management", layout: "admin", auth: "admin", view: "admin/tournaments" },
  { path: "/admin/registrations", title: "Registration Management", layout: "admin", auth: "admin", view: "admin/registrations" },
  { path: "/admin/teams", title: "Team Management", layout: "admin", auth: "admin", view: "admin/teams" },
  { path: "/admin/slots", title: "Slot Management", layout: "admin", auth: "admin", view: "admin/registrations" },
  { path: "/admin/payments", title: "Payment Management", layout: "admin", auth: "admin", view: "admin/payments" },
  { path: "/admin/payment-methods", title: "Payment Methods & Gateways", layout: "admin", auth: "admin", view: "admin/payment-methods" },
  { path: "/admin/manual-upi", title: "Manual UPI Review Queue", layout: "admin", auth: "admin", view: "admin/manual-upi" },
  { path: "/admin/rooms", title: "Room Management", layout: "admin", auth: "admin", view: "admin/rooms" },
  { path: "/admin/matches", title: "Match Scheduling", layout: "admin", auth: "admin", view: "admin/matches" },
  { path: "/admin/results", title: "Results Management", layout: "admin", auth: "admin", view: "admin/results" },
  { path: "/admin/leaderboard", title: "Leaderboard Management", layout: "admin", auth: "admin", view: "admin/leaderboard" },
  { path: "/admin/emails", title: "Email Notifications", layout: "admin", auth: "admin", view: "admin/emails" },
  { path: "/admin/banners", title: "Banner Management", layout: "admin", auth: "admin", view: "admin/banners" },
  { path: "/admin/users", title: "User Management", layout: "admin", auth: "admin", view: "admin/people" },
  { path: "/admin/staff", title: "Staff Permissions", layout: "admin", auth: "admin", view: "admin/people" },
  { path: "/admin/audit-logs", title: "Audit Logs", layout: "admin", auth: "admin", view: "admin/people" },
  { path: "/admin/settings", title: "Website Settings", layout: "admin", auth: "admin", view: "admin/settings" }
];

const compile = (r) => {
  const keys = [];
  const re = new RegExp("^" + r.path.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
  return { ...r, re, keys };
};
const COMPILED = ROUTES.map(compile);

export function matchRoute(pathname) {
  for (const r of COMPILED) {
    const m = r.re.exec(pathname);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
