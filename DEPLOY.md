> **Sabse aasaan raasta: `SETUP-GITHUB-VERCEL-SUPABASE.md` — GitHub push → Vercel auto-deploy → Supabase auto-deploy (GitHub Actions).**

# Kryvox Arena — setup & deployment (step by step)

Paid entry is **OFF** and stays off until you approve compliance in Admin → Payment Methods. Free tournaments work without any payment setup.

## 1. Supabase project
1. Create a project at supabase.com. Copy **Project URL** and **anon key** into `assets/js/config.js`.
2. Install the Supabase CLI, then: `supabase link --project-ref <ref>` and `supabase db push` (applies `supabase/migrations/0001…0006`).
3. **Auth → Providers → Google**: create an OAuth client in Google Cloud Console (type *Web*). Authorised redirect URI = `https://<ref>.supabase.co/auth/v1/callback`. Paste client ID/secret into Supabase.
4. **Auth → URL Configuration**: Site URL = your domain; add `https://your-domain.com/login` to Redirect URLs.
5. **Auth → Email Templates → Magic Link**: make the body show the code: `Your code: {{ .Token }}` (the login screen asks for the 6-digit code).
6. **Auth → SMTP**: use Resend SMTP (host `smtp.resend.com`, user `resend`, password = API key) so Supabase's own mails also come from your domain.
7. Auth → Providers → Email: keep *Confirm email* on; OTP length 6.

## 2. Edge Functions + secrets
```
cp .env.example supabase/.env.secrets   # fill in values (this file is git-ignored)
supabase secrets set --env-file supabase/.env.secrets
supabase functions deploy otp-send otp-verify mark-verified payment-create payment-verify \
  manual-upi-submit razorpay-webhook phonepe-webhook payment-reconcile email-worker email-enqueue
```
`verify_jwt = false` for the two webhooks and the two cron functions is set in `supabase/config.toml`; they authenticate by signature / `x-cron-secret` inside the function.

## 3. Schedules (every 5 min)
Dashboard → Integrations → Cron (or pg_cron + pg_net): POST to `…/functions/v1/payment-reconcile` and `…/functions/v1/email-worker` with header `x-cron-secret: <CRON_SECRET>`.

## 4. First admin
Log in once on the site, then in the SQL editor:
```sql
insert into admin_roles (user_id, role) select id, 'SUPER_ADMIN' from profiles where email = 'you@example.com';
```
Open `/admin/login`. Other staff are added from Admin → Staff Permissions.

## 5. Vercel
Import the GitHub repo as a **Static** project (no build command, output dir = repo root). `vercel.json` already rewrites `/` → welcome page and every other path → `app.html`.

## 6. Turning payments on (only when you are ready and legally cleared)
1. Admin → Payment Methods → Global: set compliance to **APPROVED**, name the reviewer, save with a reason.
2. Put the gateway secrets in Supabase secrets (step 2), set the method's environment to SANDBOX first, mark it APPROVED, enable it.
3. PhonePe/Razorpay dashboards → webhook URL shown on the method card. Razorpay events: `payment.captured`, `payment.failed`, `order.paid`. PhonePe: set username/password and use the same values in secrets.
4. Test in sandbox end-to-end, then switch environment to PRODUCTION.
5. Manual UPI: fill UPI ID / payee / QR path, enable. Reviewers need the `PAYMENT_REVIEWER` role and must verify the credit in the real bank/UPI statement before approving.

Gateways are **never** switched automatically: a failed attempt can be retried with the same or another method by the player.
