// Zero-dependency local web server (Node 18+). Run:  node server.js   (or: npm start)  ->  http://localhost:3000
// Mirrors vercel.json: "/" -> welcome.html, any other non-asset path -> app.html (so refresh works on every route).
// If a .env file (or environment) provides SUPABASE_URL + SUPABASE_ANON_KEY, /assets/js/config.js is generated from it,
// so you never have to edit code to point the site at your backend. Only the PUBLIC anon key is ever served.
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = __dirname, PORT = Number(process.env.PORT || 3000);

function loadEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (_) { /* no .env */ }
  return { ...env, ...process.env };
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".webp": "image/webp" };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const env = loadEnv();
  const send = (code, type, body) => { res.writeHead(code, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }); res.end(body); };

  if (url === "/assets/js/config.js" && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    return send(200, TYPES[".js"], `export const CONFIG = ${JSON.stringify({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY, SITE_NAME: "Kryvox Arena" })};\nexport const configured = () => Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);\n`);
  }
  let file = url === "/" ? "/welcome.html" : url.startsWith("/assets/") ? url : "/app.html";
  const full = path.normalize(path.join(ROOT, file));
  if (!full.startsWith(path.join(ROOT, "assets")) && !["welcome.html", "app.html"].includes(path.basename(full))) return send(404, "text/plain", "Not found");
  fs.readFile(full, (err, data) => err ? send(404, "text/plain", "Not found") : send(200, TYPES[path.extname(full)] || "application/octet-stream", data));
}).listen(PORT, () => {
  const e = loadEnv(), ok = e.SUPABASE_URL && e.SUPABASE_ANON_KEY;
  console.log(`\n  Kryvox Arena  ->  http://localhost:${PORT}\n  Backend: ${ok ? e.SUPABASE_URL : "NOT CONFIGURED (copy .env.example to .env and fill SUPABASE_URL + SUPABASE_ANON_KEY)"}\n`);
});
