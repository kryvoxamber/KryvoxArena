// Minimal history-API router. Vercel rewrites every non-file path to app.html, so refresh works on any route.
import { matchRoute, PLAYER_NAV, ADMIN_NAV } from "./routes.js";
import { guard, refreshHeader } from "./auth.js";

let unmount = null;
let navToken = 0;

const $ = (id) => document.getElementById(id);

function setLayout(kind) {
  const layout = $("layout");
  layout.className = "layout-" + kind;
  document.body.dataset.layout = kind;
  const hideChrome = kind === "bare" || kind === "admin";
  document.querySelectorAll("body > header, body > footer, body > .drips, body > .fab, body > .totop, body > .notice")
    .forEach((el) => { el.style.display = hideChrome ? "none" : ""; });
  let side = $("sidenav");
  if (kind === "player" || kind === "admin") {
    const items = kind === "admin" ? ADMIN_NAV : PLAYER_NAV;
    if (!side) {
      side = document.createElement("nav");
      side.id = "sidenav";
      layout.prepend(side);
    }
    side.setAttribute("aria-label", kind === "admin" ? "Admin" : "Player");
    side.innerHTML = (kind === "admin" ? '<div class="logo side-logo">KRYV<span>OX</span> <small>ADMIN</small></div>' : "") +
      items.map(([href, label]) => `<a href="${href}" data-link>${label}</a>`).join("") +
      (kind === "admin" ? '<a href="/home" data-link class="side-exit">← Public site</a>' : "");
  } else if (side) {
    side.remove();
  }
  highlight();
}

function highlight() {
  const here = location.pathname.replace(/\/$/, "") || "/";
  document.querySelectorAll("#sidenav a").forEach((a) => {
    const p = a.getAttribute("href");
    a.classList.toggle("on", p === here || (p !== "/admin" && p !== "/dashboard" && here.startsWith(p + "/")));
  });
}

async function render() {
  const token = ++navToken;
  const pathname = location.pathname === "/" ? "/home" : location.pathname;
  if (pathname !== location.pathname) history.replaceState({}, "", "/home" + location.search + location.hash);
  const hit = matchRoute(pathname);
  const app = $("app");
  if (unmount) { try { unmount(); } catch (e) { console.error(e); } unmount = null; }
  app.innerHTML = "";

  const route = hit ? hit.route : { title: "Not found", layout: "site", view: "notfound", auth: null };
  setLayout(route.layout);
  document.title = route.view === "home" ? route.title : `${route.title} – Kryvox Arena`;
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) { robots = document.createElement("meta"); robots.name = "robots"; document.head.appendChild(robots); }
  robots.content = route.path && route.path.startsWith("/admin") ? "noindex,nofollow" : "index,follow";

  try {
    if (route.auth) {
      const g = await guard(route.auth);
      if (token !== navToken) return;
      if (!g.ok) { history.replaceState({}, "", g.redirect); return render(); }
    }
    refreshHeader();
    const mod = await import(`./pages/${route.view}.js`);
    if (token !== navToken) return;
    const result = await mod.mount(app, { route, params: hit ? hit.params : {} });
    if (token !== navToken) { if (typeof result === "function") result(); return; }
    unmount = typeof result === "function" ? result : null;
  } catch (err) {
    console.error(err);
    app.innerHTML = '<section><div class="wrap"><h2>Kuch galat ho gaya</h2><p class="lead">Page load nahi ho paya. Refresh karke dobara try karo.</p></div></section>';
  }

  if (location.hash) {
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
}

export function navigate(url) {
  history.pushState({}, "", url);
  render();
}

export function start() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("#")) return; // plain in-page anchor
    if (!a.hasAttribute("data-link")) return;
    e.preventDefault();
    if (url.pathname === location.pathname && url.search === location.search) {
      history.pushState({}, "", url.pathname + url.search + url.hash);
      const el = url.hash && document.getElementById(url.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: "smooth" });
      return;
    }
    navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener("popstate", render);
  render();
}
