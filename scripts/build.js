// Vercel build step: copies the static site into dist/ and writes assets/js/config.js from environment variables,
// so the deployed website connects to YOUR Supabase project without editing code.
// Required env vars (Vercel → Project → Settings → Environment Variables): SUPABASE_URL, SUPABASE_ANON_KEY (public anon key only!).
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), out = path.join(root, "dist");
const url = (process.env.SUPABASE_URL || "").trim(), key = (process.env.SUPABASE_ANON_KEY || "").trim();

if (process.env.VERCEL && (!url || !key)) { console.error("ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in Vercel Environment Variables."); process.exit(1); }
if (/service_role/i.test(key) || (key.split(".")[1] && (() => { try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "service_role"; } catch { return false; } })())) {
  console.error("ERROR: SUPABASE_ANON_KEY looks like a service_role key. Use the public anon key; never expose service_role."); process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ["welcome.html", "app.html"]) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.cpSync(path.join(root, "assets"), path.join(out, "assets"), { recursive: true });
fs.writeFileSync(path.join(out, "assets/js/config.js"),
  `export const CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key, SITE_NAME: "Kryvox Arena" })};\nexport const configured = () => Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);\n`);
console.log(`Built dist/ (backend ${url ? url : "NOT configured"})`);
