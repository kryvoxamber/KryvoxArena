-- 0002_payments.sql  -  provider-independent payment data model.
--
-- SOURCE OF TRUTH: public.payment_orders.status is the single authoritative payment state.
-- public.payments (bottom of file) is a read-only reporting view over it. Nothing else stores payment state.
-- Secrets (PhonePe / Razorpay credentials) are NOT stored in these tables: they live in Supabase Vault / Edge
-- Function secrets. Only non-secret configuration and "secrets configured?" flags are kept here.

-- ---------------------------------------------------------------- settings
create table public.payment_global_settings (
  id                        boolean primary key default true check (id),     -- singleton row
  paid_entry_enabled        boolean not null default false,                 -- master switch
  free_entry_enabled        boolean not null default true,                  -- independent of payments
  primary_automatic_gateway text not null default 'PHONEPE' check (primary_automatic_gateway in ('PHONEPE','RAZORPAY')),
  automatic_gateway_switching boolean not null default false check (automatic_gateway_switching = false), -- never automatic
  currency                  text not null default 'INR' check (currency = 'INR'),
  attempt_expiry_minutes    int not null default 15 check (attempt_expiry_minutes between 5 and 180),
  min_amount                numeric(10,2) check (min_amount is null or min_amount > 0),
  max_amount                numeric(10,2) check (max_amount is null or max_amount > 0),
  refund_policy_text        text not null default '',
  support_contact           text not null default '',
  maintenance_message       text not null default '',
  -- Admin-maintained record of legal / merchant review. The platform never decides this by itself.
  compliance_status         text not null default 'NOT_APPROVED' check (compliance_status in ('NOT_APPROVED','APPROVED')),
  compliance_reviewer       text,
  compliance_note           text,
  compliance_approved_at    timestamptz,
  updated_by                uuid references auth.users(id),
  updated_at                timestamptz not null default now(),
  -- DB-level gate: paid entry cannot be switched on while compliance is not recorded as approved.
  constraint paid_entry_requires_compliance check (not paid_entry_enabled or compliance_status = 'APPROVED'),
  constraint approved_has_record check (compliance_status <> 'APPROVED'
                                        or (compliance_reviewer is not null and compliance_approved_at is not null)),
  constraint amount_limits check (min_amount is null or max_amount is null or min_amount <= max_amount)
);

create table public.payment_method_settings (
  id                         uuid primary key default gen_random_uuid(),
  method_code                text not null unique check (method_code in ('PHONEPE','RAZORPAY','MANUAL_UPI')),
  enabled                    boolean not null default false,
  is_primary_automatic       boolean not null default false,
  environment                text not null default 'SANDBOX' check (environment in ('SANDBOX','PRODUCTION')),
  display_name               text not null,
  public_instructions        text not null default '',
  configuration_status       text not null default 'NOT_CONFIGURED'
                             check (configuration_status in ('NOT_CONFIGURED','CONFIGURED','VERIFIED','ERROR')),
  secrets_configured         boolean not null default false,   -- flag only; the secrets themselves are in Vault
  webhook_configured         boolean not null default false,
  last_verified_at           timestamptz,
  compliance_approval_status text not null default 'NOT_APPROVED' check (compliance_approval_status in ('NOT_APPROVED','APPROVED')),
  -- non-secret settings: merchant id, upi id, payee name, qr path, utr_required, proof_enabled, reviewer roles ...
  config_public              jsonb not null default '{}'::jsonb,
  updated_by                 uuid references auth.users(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint method_enable_requires_approval check (not enabled or compliance_approval_status = 'APPROVED'),
  constraint primary_only_automatic check (not is_primary_automatic or method_code in ('PHONEPE','RAZORPAY'))
);
create unique index one_primary_automatic_uq on public.payment_method_settings (is_primary_automatic) where is_primary_automatic;
create trigger payment_method_settings_updated before update on public.payment_method_settings
  for each row execute function public.set_updated_at();

-- Safe first-deployment state: everything off, nothing approved, PhonePe preferred.
insert into public.payment_global_settings (id) values (true);
insert into public.payment_method_settings (method_code, display_name, is_primary_automatic, public_instructions) values
  ('PHONEPE',   'PhonePe', true,  ''),
  ('RAZORPAY',  'Razorpay', false, ''),
  ('MANUAL_UPI','Manual UPI', false, '');

-- Is a method currently usable for NEW attempts? Enforced server-side, never by a frontend toggle.
create or replace function public.payment_method_available(p_method text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.payment_global_settings g
    join public.payment_method_settings m on m.method_code = p_method
    where g.paid_entry_enabled and g.compliance_status = 'APPROVED'
      and m.enabled and m.compliance_approval_status = 'APPROVED'
  );
$$;

-- What the checkout page may show a player.
create or replace function public.available_payment_methods()
returns table (method_code text, display_name text, public_instructions text, is_primary_automatic boolean)
language sql stable security definer set search_path = public as $$
  select m.method_code, m.display_name, m.public_instructions, m.is_primary_automatic
  from public.payment_method_settings m
  where public.payment_method_available(m.method_code)
  order by m.is_primary_automatic desc, m.method_code;
$$;

-- ---------------------------------------------------------------- orders (one row per payment ATTEMPT)
create table public.payment_orders (
  id                     uuid primary key default gen_random_uuid(),
  booking_id             uuid not null references public.registrations(id),
  user_id                uuid not null references auth.users(id),
  method_code            text not null check (method_code in ('PHONEPE','RAZORPAY','MANUAL_UPI')),
  provider_order_id      text,                                  -- null for manual UPI
  internal_order_reference text not null unique
                         default ('KRXP' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
  idempotency_key        text unique,
  amount                 numeric(10,2) not null check (amount > 0),
  currency               text not null default 'INR' check (currency = 'INR'),
  status                 text not null default 'CREATED' check (status in
                         ('CREATED','PENDING','PROCESSING','PAYMENT_UNDER_REVIEW','SUCCESS','FAILED','EXPIRED',
                          'CANCELLED','REFUND_PENDING','REFUNDED','REJECTED','RECONCILIATION_REQUIRED')),
  provider_raw_status    text,                                  -- raw provider status kept for troubleshooting only
  expires_at             timestamptz not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index payment_orders_booking_idx on public.payment_orders (booking_id, created_at desc);
create index payment_orders_user_idx on public.payment_orders (user_id, created_at desc);
create index payment_orders_status_idx on public.payment_orders (status, expires_at);
-- A provider order id is unique inside its provider.
create unique index payment_orders_provider_uq on public.payment_orders (method_code, provider_order_id)
  where provider_order_id is not null;
-- One successful payment per booking, ever.
create unique index payment_orders_one_success_uq on public.payment_orders (booking_id)
  where status in ('SUCCESS','REFUND_PENDING','REFUNDED');
-- Only one live attempt per booking: a new attempt needs the previous one resolved first.
create unique index payment_orders_one_active_uq on public.payment_orders (booking_id)
  where status in ('CREATED','PENDING','PROCESSING','PAYMENT_UNDER_REVIEW','RECONCILIATION_REQUIRED');
create trigger payment_orders_updated before update on public.payment_orders
  for each row execute function public.set_updated_at();

-- Documented state-transition map (anything not listed is rejected).
create or replace function public.payment_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable as $$
  select p_from = p_to or (p_from, p_to) in (
    ('CREATED','PENDING'), ('CREATED','PROCESSING'), ('CREATED','PAYMENT_UNDER_REVIEW'), ('CREATED','FAILED'),
    ('CREATED','EXPIRED'), ('CREATED','CANCELLED'), ('CREATED','RECONCILIATION_REQUIRED'),
    ('PENDING','PROCESSING'), ('PENDING','SUCCESS'), ('PENDING','FAILED'), ('PENDING','EXPIRED'),
    ('PENDING','CANCELLED'), ('PENDING','RECONCILIATION_REQUIRED'),
    ('PROCESSING','PENDING'), ('PROCESSING','SUCCESS'), ('PROCESSING','FAILED'), ('PROCESSING','EXPIRED'),
    ('PROCESSING','RECONCILIATION_REQUIRED'),
    ('PAYMENT_UNDER_REVIEW','SUCCESS'), ('PAYMENT_UNDER_REVIEW','REJECTED'), ('PAYMENT_UNDER_REVIEW','CANCELLED'),
    ('PAYMENT_UNDER_REVIEW','RECONCILIATION_REQUIRED'),
    ('RECONCILIATION_REQUIRED','SUCCESS'), ('RECONCILIATION_REQUIRED','FAILED'), ('RECONCILIATION_REQUIRED','EXPIRED'),
    ('RECONCILIATION_REQUIRED','CANCELLED'), ('RECONCILIATION_REQUIRED','REJECTED'),
    -- money can arrive after we gave up on an attempt: route it to reconciliation, never straight to SUCCESS
    ('EXPIRED','RECONCILIATION_REQUIRED'), ('FAILED','RECONCILIATION_REQUIRED'), ('CANCELLED','RECONCILIATION_REQUIRED'),
    ('SUCCESS','REFUND_PENDING'), ('REFUND_PENDING','REFUNDED'), ('REFUND_PENDING','SUCCESS')
  );
$$;

create or replace function public.payment_orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  reg public.registrations;
begin
  if tg_op = 'INSERT' then
    select * into reg from public.registrations where id = new.booking_id;
    if not found then raise exception 'booking not found'; end if;
    if reg.user_id <> new.user_id then raise exception 'booking/user ownership mismatch'; end if;
    if reg.amount <> new.amount then raise exception 'order amount must equal the booking amount'; end if;
    if new.status <> 'CREATED' then raise exception 'new payment orders must start as CREATED'; end if;
    if not public.payment_method_available(new.method_code) then
      raise exception 'payment method % is not available (disabled or compliance gate not approved)', new.method_code
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE: the attempt keeps its method, owner, booking and money forever.
  if new.method_code <> old.method_code or new.user_id <> old.user_id or new.booking_id <> old.booking_id
     or new.amount <> old.amount or new.currency <> old.currency
     or new.internal_order_reference <> old.internal_order_reference then
    raise exception 'payment order identity, method and amount are immutable';
  end if;
  if old.provider_order_id is not null and new.provider_order_id is distinct from old.provider_order_id then
    raise exception 'provider_order_id cannot be changed once set';
  end if;
  if not public.payment_transition_allowed(old.status, new.status) then
    raise exception 'illegal payment status transition % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payment_orders_guard_trg before insert or update on public.payment_orders
  for each row execute function public.payment_orders_guard();
create trigger payment_orders_no_delete before delete on public.payment_orders
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------- verified transactions (immutable)
create table public.payment_transactions (
  id                    uuid primary key default gen_random_uuid(),
  payment_order_id      uuid not null unique references public.payment_orders(id),   -- one verified transaction per order
  method_code           text not null check (method_code in ('PHONEPE','RAZORPAY','MANUAL_UPI')),
  provider_transaction_id text not null,
  provider_payment_status text,
  amount                numeric(10,2) not null check (amount > 0),
  currency              text not null default 'INR' check (currency = 'INR'),
  verified_by           uuid references auth.users(id),       -- set for manual approvals
  verified_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (method_code, provider_transaction_id)
);
create trigger payment_transactions_append_only before update or delete on public.payment_transactions
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------- manual UPI
create table public.manual_upi_submissions (
  id               uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references public.payment_orders(id),
  booking_id       uuid not null references public.registrations(id),
  user_id          uuid not null references auth.users(id),
  utr_reference    text not null check (utr_reference ~ '^[A-Za-z0-9]{8,30}$'),
  payer_display_name text,
  submitted_amount numeric(10,2) check (submitted_amount is null or submitted_amount > 0),
  paid_at          timestamptz,
  submitted_at     timestamptz not null default now(),
  proof_storage_path text,                                   -- private bucket, signed URLs only
  review_status    text not null default 'PENDING'
                   check (review_status in ('PENDING','NEEDS_CLARIFICATION','APPROVED','REJECTED')),
  assigned_reviewer uuid references auth.users(id),
  reviewed_by      uuid references auth.users(id),
  reviewed_at      timestamptz,
  review_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint reviewed_has_reviewer check (review_status in ('PENDING','NEEDS_CLARIFICATION') or
                                          (reviewed_by is not null and reviewed_at is not null and review_reason is not null))
);
-- The same UTR cannot be live (pending or approved) on more than one submission.
create unique index manual_upi_utr_live_uq on public.manual_upi_submissions (upper(utr_reference))
  where review_status in ('PENDING','NEEDS_CLARIFICATION','APPROVED');
create index manual_upi_queue_idx on public.manual_upi_submissions (review_status, submitted_at);
create trigger manual_upi_updated before update on public.manual_upi_submissions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- webhooks, reconciliation, logs, refunds
create table public.payment_webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null check (provider in ('PHONEPE','RAZORPAY')),
  provider_event_id text not null,
  event_type        text not null,
  signature_verified boolean not null,
  processing_status text not null default 'RECEIVED'
                    check (processing_status in ('RECEIVED','PROCESSED','IGNORED','FAILED')),
  payload           jsonb,                                     -- provider body only, never headers/secrets
  error             text,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  unique (provider, provider_event_id)                         -- duplicate / replayed webhooks cannot be processed twice
);

create table public.payment_reconciliation_logs (
  id                    uuid primary key default gen_random_uuid(),
  payment_order_id      uuid not null references public.payment_orders(id),
  provider              text not null,
  expected_amount       numeric(10,2) not null,
  observed_amount       numeric(10,2),
  observed_status       text,
  reconciliation_status text not null check (reconciliation_status in ('MATCHED','MISMATCH','NOT_FOUND','PENDING','RESOLVED')),
  notes                 text,
  checked_by            uuid references auth.users(id),
  checked_at            timestamptz not null default now()
);
create index recon_order_idx on public.payment_reconciliation_logs (payment_order_id, checked_at desc);
create trigger recon_append_only before update or delete on public.payment_reconciliation_logs
  for each row execute function public.forbid_mutation();

create table public.gateway_activity_logs (
  id                 uuid primary key default gen_random_uuid(),
  provider_or_method text not null,
  action             text not null,
  old_value          jsonb,
  new_value          jsonb,
  status             text not null default 'OK',
  admin_id           uuid references auth.users(id),
  reason             text,
  created_at         timestamptz not null default now()
);
create trigger gateway_logs_append_only before update or delete on public.gateway_activity_logs
  for each row execute function public.forbid_mutation();

create table public.refund_records (
  id                     uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null references public.payment_transactions(id),
  refund_reference       text not null,
  amount                 numeric(10,2) not null check (amount > 0),
  currency               text not null default 'INR' check (currency = 'INR'),
  reason                 text not null,
  status                 text not null default 'PENDING' check (status in ('PENDING','SUCCESS','FAILED')),
  independently_verified boolean not null default false,        -- must be true before SUCCESS
  initiated_by           uuid references auth.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (payment_transaction_id, refund_reference),
  constraint refund_success_needs_verification check (status <> 'SUCCESS' or independently_verified)
);
create trigger refund_records_updated before update on public.refund_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- reporting view (NOT a second source of truth)
create view public.payments with (security_invoker = true) as
  select o.id, o.booking_id, o.user_id, o.method_code, o.internal_order_reference, o.provider_order_id,
         o.amount, o.currency, o.status, o.expires_at, o.created_at,
         t.provider_transaction_id, t.verified_at
  from public.payment_orders o
  left join public.payment_transactions t on t.payment_order_id = o.id;
