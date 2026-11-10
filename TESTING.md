# What was actually tested (and what was not)

## Run and passing
| Area | How | Result |
|---|---|---|
| Migrations 0001–0008 | Applied in order on a real PostgreSQL 16 (with stub `auth`/`storage` schemas and the three Supabase roles) | Apply cleanly |
| Last-slot race | 20 parallel sessions booking a 3-slot mode | exactly 3 succeed, 17 get `SLOTS_FULL`, 3 rows in DB |
| Compliance gate | Paid booking / enabling a method with compliance not approved; withdrawing approval | Blocked by DB; withdrawal switches paid entry + all methods off |
| Payment lifecycle (SQL) | order → manual UPI submit → reviewer approve → booking CONFIRMED; second attempt while one is active; replay; illegal status jumps; amount/identity edits; deletes; transaction update | All behave as designed (see `payments` errors: `ACTIVE_ATTEMPT_EXISTS`, `CREDIT_NOT_VERIFIED`, `ALREADY_REVIEWED`, append-only/immutable guards) |
| RLS | Player cannot read others' registrations, call finalize/admin RPCs, write payments, read audit logs; team edit allowed before and blocked after the deadline; suspended user cannot book | Verified |
| Admin RPCs | result save/publish → leaderboard, duplicate placement, hold/cancel rules, UID override with duplicate check, last-super-admin protection, self-ban block, audit rows | Verified |
| Edge-function logic | `node --test tests/*.test.ts`: HMAC/SHA vectors, Razorpay checkout+webhook signatures, status mapping, PhonePe webhook auth, request shapes against mocked `fetch`, email HTML escaping | 16/16 pass |
| Edge-function types | `tsc` strict over all 23 function files with Deno/supabase stubs | No errors |
| Frontend | Real Chromium: all route groups load, guards redirect, no JS errors, homepage keeps the supplied design | Pass (backend not configured, so empty/“not configured” states) |

Two real bugs were found and fixed by these runs: infinite recursion between the `teams`/`team_members` RLS policies, and the homepage nav script crashing on non-anchor links.

## NOT tested (needs your accounts / network)
- Anything against a real Supabase project: Google OAuth, Supabase email/password login, Storage policies, Edge Function runtime (Deno), CORS.
- Resend delivery.
- **PhonePe and Razorpay against their sandboxes.** The adapters are written from the providers' documented APIs and unit-tested with mocked HTTP, but endpoint paths/fields (especially PhonePe PG v2) must be confirmed in sandbox before go-live.
- Browser payment UI (Razorpay Checkout popup, PhonePe redirect, manual UPI form) and the admin screens with live data.
- Load/performance beyond the 20-way race.

## Known gaps / decisions
- Admin-reserved slots (holding a slot without a player) are not implemented; use Close registration or HELD status.
- Banners can be managed in Admin but the supplied homepage design has no banner area, so they are not rendered.
- Login is plain email+password / Google (no OTP). `email_verified` is set automatically at signup (migration 0008); password signups are not email-verified unless you enable Supabase "Confirm email".
- No Content-Security-Policy header yet (the page loads supabase-js from esm.sh and Razorpay Checkout from checkout.razorpay.com).
