-- 0001_core.sql  -  identity, roles, tournaments, teams, registrations, matches, content, logs.
-- Payment tables are in 0002. Functions in 0003. RLS in 0004. Storage in 0005.

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Rows that must never change once written (audit trails, financial records).
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% on % is not allowed: table is append-only', tg_op, tg_table_name using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text,
  email             text not null,
  phone             text,
  country           text,
  state             text,
  city              text,
  avatar_url        text,
  -- Server-controlled: clients have no UPDATE privilege on these (see 0004 column grants).
  email_verified    boolean not null default false,
  email_verified_at timestamptz,
  profile_completed boolean not null default false,
  status            text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','BANNED')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_phone_format check (phone is null or phone ~ '^\+?[0-9]{8,15}$')
);
-- Duplicate account prevention: one account per email and per phone number.
create unique index profiles_email_uq on public.profiles (lower(email));
create unique index profiles_phone_uq on public.profiles (phone) where phone is not null;
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- Email OTP codes. Only hashes are stored; verification happens in an Edge Function (stage 7).
create table public.email_verification_otps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index email_otps_user_idx on public.email_verification_otps (user_id, created_at desc);

-- ---------------------------------------------------------------- staff roles
create table public.admin_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in
             ('SUPER_ADMIN','TOURNAMENT_MANAGER','RESULT_MANAGER','SUPPORT_MANAGER','EMAIL_MANAGER','PAYMENT_REVIEWER')),
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_roles r
    where r.user_id = auth.uid() and (r.role = 'SUPER_ADMIN' or r.role = any (roles))
  );
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles r where r.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------- audit log (append-only)
create table public.admin_audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users(id),
  action     text not null,
  entity     text not null,
  entity_id  text,
  old_value  jsonb,
  new_value  jsonb,
  reason     text,
  created_at timestamptz not null default now()
);
create index audit_entity_idx on public.admin_audit_logs (entity, entity_id, created_at desc);
create trigger audit_append_only before update or delete on public.admin_audit_logs
  for each row execute function public.forbid_mutation();

create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text,
                                              p_old jsonb, p_new jsonb, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit_logs (actor_id, action, entity, entity_id, old_value, new_value, reason)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_old, p_new, p_reason);
$$;
revoke all on function public.write_audit(text,text,text,jsonb,jsonb,text) from public, anon, authenticated;

-- ---------------------------------------------------------------- tournaments
create table public.tournaments (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique,
  title                    text not null,
  game                     text not null check (game in ('FREE_FIRE','BGMI')),
  description              text,
  banner_url               text,
  status                   text not null default 'DRAFT'
                           check (status in ('DRAFT','PUBLISHED','LIVE','COMPLETED','CANCELLED','POSTPONED')),
  is_featured              boolean not null default false,
  starts_at                timestamptz not null,
  registration_opens_at    timestamptz,
  registration_deadline    timestamptz not null,
  team_change_deadline     timestamptz not null,
  registration_closed      boolean not null default false,   -- manual admin close/reopen
  scoring_rules            jsonb not null default '{"placement":[12,9,8,7,6,5,4,3,2,1],"per_kill":1}'::jsonb,
  created_by               uuid references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint tournaments_deadlines check (registration_deadline <= starts_at and team_change_deadline <= starts_at)
);
create index tournaments_status_idx on public.tournaments (status, starts_at);
create trigger tournaments_updated before update on public.tournaments for each row execute function public.set_updated_at();

-- One row per mode a tournament offers. Slots, fee and prize live here; team size is admin-configurable.
create table public.tournament_modes (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null references public.tournaments(id) on delete cascade,
  mode                text not null check (mode in ('SOLO','DUO','SQUAD')),
  team_size           int not null check (team_size between 1 and 6),
  total_slots         int not null check (total_slots > 0),
  entry_fee           numeric(10,2) not null default 0 check (entry_fee >= 0),
  currency            text not null default 'INR' check (currency = 'INR'),
  prize_pool          numeric(12,2) not null default 0 check (prize_pool >= 0),
  prize_breakdown     jsonb not null default '[]'::jsonb,
  most_kills_bonus    numeric(10,2) not null default 0 check (most_kills_bonus >= 0),
  registration_closed boolean not null default false,        -- set automatically when full, or by admin
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tournament_id, mode)
);
create trigger tournament_modes_updated before update on public.tournament_modes for each row execute function public.set_updated_at();

create table public.tournament_rules (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,   -- null = global rule
  title         text not null,
  body          text not null,
  sort_order    int not null default 0,
  published     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger tournament_rules_updated before update on public.tournament_rules for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- teams
create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  leader_id  uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index teams_leader_name_uq on public.teams (leader_id, lower(btrim(name)));
create trigger teams_updated before update on public.teams for each row execute function public.set_updated_at();

create table public.team_members (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,   -- null for teammates without an account
  position    int not null check (position between 1 and 6),
  is_captain  boolean not null default false,
  full_name   text not null,
  game_uid    text not null check (game_uid ~ '^[0-9]{6,15}$'),
  ingame_name text not null check (char_length(btrim(ingame_name)) between 1 and 40),
  email       text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, position),
  unique (team_id, game_uid)
);
create unique index team_one_captain_uq on public.team_members (team_id) where is_captain;
create trigger team_members_updated before update on public.team_members for each row execute function public.set_updated_at();

create table public.team_change_logs (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  changed_by uuid references auth.users(id),
  change     text not null,
  old_value  jsonb,
  new_value  jsonb,
  is_admin_override boolean not null default false,
  reason     text,
  created_at timestamptz not null default now()
);
create index team_change_logs_idx on public.team_change_logs (team_id, created_at desc);
create trigger team_change_logs_append_only before update or delete on public.team_change_logs
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------- registrations
create table public.registrations (
  id                 uuid primary key default gen_random_uuid(),
  booking_code       text not null unique
                     default ('KRX-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  tournament_id      uuid not null references public.tournaments(id),
  tournament_mode_id uuid not null references public.tournament_modes(id),
  team_id            uuid not null references public.teams(id),
  user_id            uuid not null references auth.users(id),
  -- RESERVED: slot held, payment not started. PENDING_PAYMENT: an attempt exists. CONFIRMED: slot owned.
  status             text not null default 'RESERVED'
                     check (status in ('RESERVED','PENDING_PAYMENT','CONFIRMED','HELD','EXPIRED','CANCELLED')),
  reserved_until     timestamptz,
  amount             numeric(10,2) not null default 0 check (amount >= 0),   -- snapshot of the mode fee at booking time
  currency           text not null default 'INR' check (currency = 'INR'),
  country            text not null,
  state              text not null,
  contact_email      text not null,
  contact_phone      text not null,
  is_admin_reserved  boolean not null default false,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint registrations_reserved_until check (status not in ('RESERVED','PENDING_PAYMENT') or reserved_until is not null)
);
create index registrations_user_idx on public.registrations (user_id, created_at desc);
create index registrations_mode_status_idx on public.registrations (tournament_mode_id, status);
create index registrations_tournament_idx on public.registrations (tournament_id);
-- A user may hold only one live registration per tournament, a team only one per tournament.
create unique index registrations_user_tournament_uq on public.registrations (user_id, tournament_id)
  where status in ('RESERVED','PENDING_PAYMENT','CONFIRMED','HELD');
create unique index registrations_team_tournament_uq on public.registrations (team_id, tournament_id)
  where status in ('RESERVED','PENDING_PAYMENT','CONFIRMED','HELD');
create trigger registrations_updated before update on public.registrations for each row execute function public.set_updated_at();

-- Snapshot of the players on a registration. Lets the database enforce "one UID per tournament".
create table public.registration_players (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  tournament_id   uuid not null references public.tournaments(id),
  game_uid        text not null,
  ingame_name     text not null,
  full_name       text not null,
  is_captain      boolean not null default false,
  active          boolean not null default true,     -- cleared when the registration expires/cancels
  created_at      timestamptz not null default now()
);
create unique index registration_players_uid_uq on public.registration_players (tournament_id, game_uid) where active;
create index registration_players_reg_idx on public.registration_players (registration_id);

-- ---------------------------------------------------------------- matches, rooms, results
create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  title         text not null,
  round_no      int not null default 1 check (round_no > 0),
  scheduled_at  timestamptz not null,
  status        text not null default 'SCHEDULED'
                check (status in ('SCHEDULED','LIVE','COMPLETED','CANCELLED','POSTPONED')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index matches_tournament_idx on public.matches (tournament_id, scheduled_at);
create trigger matches_updated before update on public.matches for each row execute function public.set_updated_at();

create table public.room_credentials (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id      uuid references public.matches(id) on delete cascade,
  room_id       text not null,
  room_password text not null,
  instructions  text,
  status        text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','HIDDEN','REMOVED')),
  version       int not null default 1,
  published_at  timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index room_credentials_one_live_uq on public.room_credentials
  (tournament_id, coalesce(match_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status in ('DRAFT','PUBLISHED','HIDDEN');
create trigger room_credentials_updated before update on public.room_credentials for each row execute function public.set_updated_at();

create table public.match_results (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches(id) on delete cascade,
  registration_id uuid not null references public.registrations(id),
  placement       int not null check (placement > 0),
  kills           int not null default 0 check (kills >= 0),
  points          numeric(8,2) not null default 0,
  is_winner       boolean not null default false,
  proof_url       text,
  match_date      date not null,
  published       boolean not null default false,
  entered_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (match_id, registration_id)
);
create unique index match_results_one_winner_uq on public.match_results (match_id) where is_winner;
create trigger match_results_updated before update on public.match_results for each row execute function public.set_updated_at();

-- Aggregated standings, rebuilt by a server function when results are published (stage 19).
create table public.leaderboard_entries (
  id             uuid primary key default gen_random_uuid(),
  scope          text not null check (scope in ('TOURNAMENT','OVERALL')),
  tournament_id  uuid references public.tournaments(id) on delete cascade,
  game           text not null check (game in ('FREE_FIRE','BGMI')),
  mode           text not null check (mode in ('SOLO','DUO','SQUAD')),
  team_id        uuid not null references public.teams(id) on delete cascade,
  team_name      text not null,
  country        text,
  state          text,
  points         numeric(10,2) not null default 0,
  kills          int not null default 0,
  wins           int not null default 0,
  matches_played int not null default 0,
  updated_at     timestamptz not null default now(),
  constraint leaderboard_scope_ck check ((scope = 'TOURNAMENT') = (tournament_id is not null))
);
create unique index leaderboard_uq on public.leaderboard_entries
  (scope, coalesce(tournament_id,'00000000-0000-0000-0000-000000000000'::uuid), game, mode, team_id);
create index leaderboard_rank_idx on public.leaderboard_entries (scope, game, mode, points desc);

-- ---------------------------------------------------------------- content
create table public.banners (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  image_path  text not null,
  link_url    text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  enabled     boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint banners_dates check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create trigger banners_updated before update on public.banners for each row execute function public.set_updated_at();

create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  published  boolean not null default false,
  pinned     boolean not null default false,
  starts_at  timestamptz,
  ends_at    timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger announcements_updated before update on public.announcements for each row execute function public.set_updated_at();

create table public.site_settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null default false,   -- only public keys are readable by anon visitors
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- notifications, email
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.email_queue (
  id              uuid primary key default gen_random_uuid(),
  template        text not null check (template in
                  ('REGISTRATION_CONFIRMATION','REGISTRATION_STATUS','MATCH_REMINDER','MATCH_STARTING','ROOM_DETAILS',
                   'ROOM_DETAILS_UPDATE','TOURNAMENT_POSTPONED','TOURNAMENT_CANCELLED','WINNER_ANNOUNCEMENT','CUSTOM')),
  recipient_user  uuid references auth.users(id) on delete set null,
  to_email        text not null,
  subject         text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED','CANCELLED')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  dedupe_key      text unique,                 -- same key twice = same email, so duplicates cannot be queued
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index email_queue_due_idx on public.email_queue (status, next_attempt_at);

create table public.email_logs (
  id          uuid primary key default gen_random_uuid(),
  queue_id    uuid references public.email_queue(id) on delete set null,
  to_email    text not null,
  template    text not null,
  status      text not null check (status in ('SENT','FAILED')),
  provider_id text,
  error       text,
  created_at  timestamptz not null default now()
);
create trigger email_logs_append_only before update or delete on public.email_logs
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------- reports
create table public.user_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete set null,
  against_uid text,
  kind        text not null check (kind in ('CHEATING','ABUSE','PAYMENT_ISSUE','OTHER')),
  details     text not null check (char_length(details) between 10 and 2000),
  status      text not null default 'OPEN' check (status in ('OPEN','IN_REVIEW','RESOLVED','DISMISSED')),
  handled_by  uuid references auth.users(id),
  resolution  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger user_reports_updated before update on public.user_reports for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- new auth user -> profile
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
