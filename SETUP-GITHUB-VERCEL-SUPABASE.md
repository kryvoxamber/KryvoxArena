# GitHub → Vercel → Supabase (sab connect, ek baar ka setup)

## 1) Supabase project (supabase.com, free)
1. New project banao. Database password yaad rakho.
2. Project Settings → API se copy karo: **Project URL**, **anon public key**, aur Settings → General se **Reference ID**.
3. Auth → Providers → Google: Google Cloud Console mein OAuth client banao, redirect URI = `https://<REF>.supabase.co/auth/v1/callback`, ID/secret yahan paste karo.
4. Auth → Email Templates → Magic Link body mein likho: `Your code: {{ .Token }}`
5. (Vercel URL milne ke baad, step 4 ke baad) Auth → URL Configuration: Site URL = `https://tumhara-site.vercel.app`, Redirect URLs mein `https://tumhara-site.vercel.app/login` add karo.

## 2) GitHub
Is folder ko GitHub repo mein push karo (`git init`, `git add .`, `git commit`, `git push`) — branch `main`.
Repo → Settings → Secrets and variables → Actions → New secret:
| Secret | Kahan se |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | Reference ID |
| `SUPABASE_DB_PASSWORD` | project banate waqt ka password |
| `SITE_URL` | `https://tumhara-site.vercel.app` |
| `OTP_PEPPER`, `CRON_SECRET` | koi bhi lamba random string (`openssl rand -hex 32`) |
| `RESEND_API_KEY`, `EMAIL_FROM` | resend.com (domain verify karo) — bina iske OTP email nahi jayega |
Payment secrets (PhonePe/Razorpay) tabhi daalo jab paid entry chalu karni ho (DEPLOY.md step 6).

Secrets daalne ke baad Actions tab → **Deploy Supabase** → *Run workflow*. Ye khud: migrations lagata hai, secrets set karta hai, saare Edge Functions deploy karta hai. Uske baad har push par (supabase/ folder badalne par) auto-deploy.

## 3) Vercel
1. vercel.com → Add New → Project → GitHub repo import karo. Framework: *Other*. Build settings `vercel.json` se aa jaate hain (build: `node scripts/build.js`, output: `dist`).
2. Environment Variables: `SUPABASE_URL` = Project URL, `SUPABASE_ANON_KEY` = anon public key (**service_role kabhi nahi**).
3. Deploy. Build tab fail hoga agar ye vars missing hain (jaan-boojh ke, taaki bina backend ka site live na ho).

## 4) Pehla admin
Site par ek baar login karo, phir Supabase → SQL editor:
`insert into admin_roles (user_id, role) select id, 'SUPER_ADMIN' from profiles where email = 'tumhara@email.com';`
Phir `/admin/login`.

## 5) Cron (har 5 min): payment-reconcile aur email-worker
Supabase → Integrations → Cron → HTTP request: `POST https://<REF>.supabase.co/functions/v1/email-worker` (aur `payment-reconcile`), header `x-cron-secret: <CRON_SECRET>`.

Paid entry default band hai; chalu karne se pehle Admin → Payment Methods mein compliance approve karna hoga.
