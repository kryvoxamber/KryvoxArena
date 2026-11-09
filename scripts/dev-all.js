// One command to run everything locally:  npm run dev:all
// Starts: Supabase (Docker) -> Edge Functions -> this website. Requires Docker Desktop + Supabase CLI (npm i -g supabase).
const { spawn, execSync } = require("child_process"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."); const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
try { execSync("supabase --version", { stdio: "ignore" }); } catch { console.error("Supabase CLI nahi mila. Install: npm i -g supabase  (aur Docker Desktop chalu hona chahiye)"); process.exit(1); }
run("supabase start");
const status = JSON.parse(execSync("supabase status -o json", { cwd: root }).toString());
const env = `SUPABASE_URL=${status.API_URL}\nSUPABASE_ANON_KEY=${status.ANON_KEY}\n`;
if (!fs.existsSync(path.join(root, ".env"))) { fs.writeFileSync(path.join(root, ".env"), env); console.log("Wrote .env with local Supabase URL/key"); }
const secrets = path.join(root, "supabase", ".env.secrets");
if (!fs.existsSync(secrets)) fs.writeFileSync(secrets, `SITE_URL=http://localhost:3000\nOTP_PEPPER=local-dev-pepper-change-me-0123456789\nCRON_SECRET=local-cron-secret\n# RESEND_API_KEY=\n# EMAIL_FROM=\n`);
spawn("supabase", ["functions", "serve", "--env-file", "supabase/.env.secrets", "--no-verify-jwt"], { cwd: root, stdio: "inherit" });
spawn(process.execPath, ["server.js"], { cwd: root, stdio: "inherit" });
console.log("Local Supabase Studio: " + status.STUDIO_URL + "  |  Local emails (Inbucket): " + (status.INBUCKET_URL || "http://127.0.0.1:54324"));
