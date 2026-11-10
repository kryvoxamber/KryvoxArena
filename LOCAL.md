# Local pe chalana (sab ek hi folder mein)

Is folder mein frontend + backend dono hain: `assets/`, `welcome.html`, `app.html` (website) aur `supabase/` (database, auth rules, edge functions).

## Sabse aasaan: sirf website dekhna (30 sec)
```
node server.js        # ya: npm start
```
Browser: http://localhost:3000  (welcome page)  →  http://localhost:3000/home
Backend jode bina login/registration kaam nahi karte; baaki pages "not configured" dikhate hain (koi fake data nahi).

## Poora system local (website + database + login + functions)
Chahiye: Node 18+, Docker Desktop, Supabase CLI (`npm i -g supabase`).
```
npm run dev:all
```
Ye khud: local Supabase start karta hai (migrations 0001–0006 apne aap lagti hain), `.env` banata hai, Edge Functions serve karta hai aur website chalata hai.
- Website: http://localhost:3000
- Database UI (Studio): http://127.0.0.1:54323
- Local email inbox (confirmation/reset mails): http://127.0.0.1:54324
- Pehla admin: Studio → SQL editor:
  `insert into admin_roles (user_id, role) select id, 'SUPER_ADMIN' from profiles where email = 'you@example.com';`

Login email + password se hota hai (local mein confirm-email off hai). Google login ke liye `GOOGLE_CLIENT_ID/SECRET` env set karo.

## Cloud Supabase ke saath local website
`.env.example` ko `.env` copy karo, sirf `SUPABASE_URL` aur `SUPABASE_ANON_KEY` bharo, phir `npm start`.

Live deploy ke liye `DEPLOY.md` dekho.
