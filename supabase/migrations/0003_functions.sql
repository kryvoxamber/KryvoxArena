-- 0003_functions.sql  -  atomic booking, payment lifecycle and admin RPCs.
-- Clients never write registrations / payments directly (no INSERT/UPDATE policies exist in 0004);
-- everything goes through these SECURITY DEFINER functions, which validate on the server.

-- ---------------------------------------------------------------- public availability (counts only, no personal data)
create view public.tournament_mode_availability as
  select m.id as tournament_mode_id, m.tournament_id, m.mode, m.total_slots,
         coalesce(c.booked, 0)::int as booked_slots,
         greatest(m.total_slots - coalesce(c.booked, 0), 0)::int as available_slots,
         (coalesce(c.booked, 0) >= m.total_slots) as is_full,
         (t.status = 'PUBLISHED'
          and not t.registration_closed and not m.registration_closed
          and coalesce(c.booked, 0) < m.total_slots
          and now() >= coalesce(t.registration_opens_at, '-infinity'::timestamptz)
          and now() <= t.registration_deadline) as registration_open
  from public.tournament_modes m
  join public.tournaments t on t.id = m.tournament_id
  left join (
    select tournament_mode_id, count(*) as booked
    from public.registrations
    where status in ('RESERVED','PENDING_PAYMENT','CONFIRMED','HELD')
    group by tournament_mode_id
  ) c on c.tournament_mode_id = m.id
  where t.status in ('PUBLISHED','LIVE','COMPLETED');

-- ---------------------------------------------------------------- expiry
create or replace function public.expire_stale_payment_orders() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- never reached the provider / never submitted: simply expire
  update public.payment_orders set status = 'EXPIRED'
   where status = 'CREATED' and expires_at < now();
  -- may have succeeded without us knowing: must be reconciled, never silently dropped
  update public.payment_orders set status = 'RECONCILIATION_REQUIRED'
   where status in ('PENDING','PROCESSING') and expires_at < now();
end $$;

create or replace function public.release_expired_reservations(p_mode uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.expire_stale_payment_orders();
  with gone as (
    update public.registrations r set status = 'EXPIRED'
     where r.status in ('RESERVED','PENDING_PAYMENT') and r.reserved_until < now()
       and (p_mode is null or r.tournament_mode_id = p_mode)
       and not exists (select 1 from public.payment_orders o
                        where o.booking_id = r.id
                          and o.status in ('CREATED','PENDING','PROCESSING','PAYMENT_UNDER_REVIEW','RECONCILIATION_REQUIRED'))
    returning r.id)
  select count(*) into n from gone;
  update public.registration_players p set active = false
    from public.registrations r
   where r.id = p.registration_id and r.status in ('EXPIRED','CANCELLED') and p.active;
  return n;
end $$;
revoke all on function public.expire_stale_payment_orders() from public, anon, authenticated;
revoke all on function public.release_expired_reservations(uuid) from public, anon, authenticated;
grant execute on function public.expire_stale_payment_orders() to service_role;
grant execute on function public.release_expired_reservations(uuid) to service_role;

-- ---------------------------------------------------------------- booking (atomic)
-- p_players: [{"full_name","game_uid","ingame_name","email"?,"phone"?}, ...]; element 1 is the captain (the caller).
create or replace function public.book_slot(
  p_mode_id uuid, p_team_name text, p_country text, p_state text,
  p_contact_email text, p_contact_phone text, p_players jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.profiles;
  m public.tournament_modes;
  t public.tournaments;
  g public.payment_global_settings;
  booked int;
  team_id uuid;
  reg_id uuid;
  reg_status text;
  reserve_until timestamptz;
  pl jsonb;
  i int := 0;
  uids text[] := '{}';
  uid_val text;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001'; end if;
  select * into prof from public.profiles where id = uid;
  if not found or not prof.email_verified or not prof.profile_completed or prof.status <> 'ACTIVE' then
    raise exception 'PROFILE_NOT_VERIFIED' using errcode = 'P0001';
  end if;

  -- Lock the mode row: concurrent bookings for the last slot queue up here, so overbooking is impossible.
  select * into m from public.tournament_modes where id = p_mode_id for update;
  if not found then raise exception 'MODE_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into t from public.tournaments where id = m.tournament_id;
  select * into g from public.payment_global_settings;

  if t.status <> 'PUBLISHED' or t.registration_closed or m.registration_closed then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;
  if now() < coalesce(t.registration_opens_at, '-infinity'::timestamptz) then
    raise exception 'REGISTRATION_NOT_OPEN' using errcode = 'P0001'; end if;
  if now() > t.registration_deadline then raise exception 'DEADLINE_PASSED' using errcode = 'P0001'; end if;

  if p_players is null or jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) <> m.team_size then
    raise exception 'WRONG_TEAM_SIZE' using errcode = 'P0001'; end if;
  if btrim(coalesce(p_country,'')) = '' or btrim(coalesce(p_state,'')) = '' then
    raise exception 'LOCATION_REQUIRED' using errcode = 'P0001'; end if;
  if p_contact_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL' using errcode = 'P0001'; end if;
  if p_contact_phone !~ '^\+?[0-9]{8,15}$' then raise exception 'INVALID_PHONE' using errcode = 'P0001'; end if;

  perform public.release_expired_reservations(m.id);
  select count(*) into booked from public.registrations
   where tournament_mode_id = m.id and status in ('RESERVED','PENDING_PAYMENT','CONFIRMED','HELD');
  if booked >= m.total_slots then raise exception 'SLOTS_FULL' using errcode = 'P0001'; end if;

  if m.entry_fee = 0 then
    if not g.free_entry_enabled then raise exception 'FREE_ENTRY_DISABLED' using errcode = 'P0001'; end if;
    reg_status := 'CONFIRMED'; reserve_until := null;
  else
    -- Paid entry is impossible until the compliance gate and at least one method are approved and enabled.
    if not exists (select 1 from public.available_payment_methods()) then
      raise exception 'PAID_ENTRY_DISABLED' using errcode = 'P0001'; end if;
    if (g.min_amount is not null and m.entry_fee < g.min_amount) or (g.max_amount is not null and m.entry_fee > g.max_amount) then
      raise exception 'AMOUNT_OUT_OF_RANGE' using errcode = 'P0001'; end if;
    reg_status := 'RESERVED'; reserve_until := now() + make_interval(mins => g.attempt_expiry_minutes);
  end if;

  begin
    insert into public.teams (leader_id, name) values (uid, btrim(p_team_name)) returning id into team_id;
  exception when unique_violation then
    raise exception 'TEAM_NAME_TAKEN' using errcode = 'P0001';
  end;

  for pl in select * from jsonb_array_elements(p_players) loop
    i := i + 1;
    uid_val := btrim(coalesce(pl->>'game_uid',''));
    if uid_val !~ '^[0-9]{6,15}$' then raise exception 'INVALID_UID' using errcode = 'P0001'; end if;
    if btrim(coalesce(pl->>'full_name','')) = '' or btrim(coalesce(pl->>'ingame_name','')) = '' then
      raise exception 'PLAYER_DETAILS_REQUIRED' using errcode = 'P0001'; end if;
    if uid_val = any (uids) then raise exception 'DUPLICATE_UID_IN_TEAM' using errcode = 'P0001'; end if;
    uids := uids || uid_val;
    insert into public.team_members (team_id, user_id, position, is_captain, full_name, game_uid, ingame_name, email, phone)
    values (team_id, case when i = 1 then uid end, i, i = 1, btrim(pl->>'full_name'), uid_val,
            btrim(pl->>'ingame_name'), nullif(btrim(coalesce(pl->>'email','')),''), nullif(btrim(coalesce(pl->>'phone','')),''));
  end loop;

  begin
    insert into public.registrations (tournament_id, tournament_mode_id, team_id, user_id, status, reserved_until,
                                      amount, country, state, contact_email, contact_phone, confirmed_at)
    values (t.id, m.id, team_id, uid, reg_status, reserve_until, m.entry_fee, btrim(p_country), btrim(p_state),
            lower(btrim(p_contact_email)), p_contact_phone, case when reg_status = 'CONFIRMED' then now() end)
    returning id into reg_id;
  exception when unique_violation then
    raise exception 'ALREADY_REGISTERED' using errcode = 'P0001';
  end;

  begin
    insert into public.registration_players (registration_id, tournament_id, game_uid, ingame_name, full_name, is_captain)
    select reg_id, t.id, btrim(e->>'game_uid'), btrim(e->>'ingame_name'), btrim(e->>'full_name'), (ord = 1)
      from jsonb_array_elements(p_players) with ordinality as x(e, ord);
  exception when unique_violation then
    raise exception 'UID_ALREADY_REGISTERED' using errcode = 'P0001';
  end;

  if reg_status = 'CONFIRMED' then
    insert into public.notifications (user_id, kind, title, body, link)
    values (uid, 'REGISTRATION', 'Registration confirmed', t.title || ' - slot booked.', '/dashboard');
    insert into public.email_queue (template, recipient_user, to_email, subject, payload, dedupe_key)
    values ('REGISTRATION_CONFIRMATION', uid, lower(btrim(p_contact_email)), 'Registration confirmed: ' || t.title,
            jsonb_build_object('registration_id', reg_id), 'reg-confirm:' || reg_id);
  end if;
  return reg_id;
end $$;
revoke all on function public.book_slot(uuid,text,text,text,text,text,jsonb) from public, anon;
grant execute on function public.book_slot(uuid,text,text,text,text,text,jsonb) to authenticated;

-- ---------------------------------------------------------------- payment attempt creation (service role only)
create or replace function public.create_payment_order(
  p_user uuid, p_registration uuid, p_method text, p_idempotency_key text default null)
returns public.payment_orders
language plpgsql security definer set search_path = public as $$
declare
  reg public.registrations;
  g public.payment_global_settings;
  ord public.payment_orders;
  exp timestamptz;
begin
  if p_idempotency_key is not null then
    select * into ord from public.payment_orders where idempotency_key = p_idempotency_key;
    if found then
      if ord.user_id <> p_user then raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001'; end if;
      return ord;
    end if;
  end if;

  select * into reg from public.registrations where id = p_registration for update;
  if not found or reg.user_id <> p_user then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001'; end if;
  if reg.status not in ('RESERVED','PENDING_PAYMENT') then raise exception 'BOOKING_NOT_PAYABLE' using errcode = 'P0001'; end if;
  if reg.reserved_until < now() then raise exception 'RESERVATION_EXPIRED' using errcode = 'P0001'; end if;
  if reg.amount <= 0 then raise exception 'BOOKING_IS_FREE' using errcode = 'P0001'; end if;

  perform public.expire_stale_payment_orders();
  -- A previous attempt may already have succeeded: the player must wait for / trigger reconciliation first.
  if exists (select 1 from public.payment_orders
              where booking_id = reg.id
                and status in ('CREATED','PENDING','PROCESSING','PAYMENT_UNDER_REVIEW','RECONCILIATION_REQUIRED')) then
    raise exception 'ACTIVE_ATTEMPT_EXISTS' using errcode = 'P0001';
  end if;
  if not public.payment_method_available(p_method) then
    raise exception 'METHOD_UNAVAILABLE' using errcode = 'P0001'; end if;

  select * into g from public.payment_global_settings;
  if (g.min_amount is not null and reg.amount < g.min_amount) or (g.max_amount is not null and reg.amount > g.max_amount) then
    raise exception 'AMOUNT_OUT_OF_RANGE' using errcode = 'P0001'; end if;

  exp := now() + make_interval(mins => g.attempt_expiry_minutes);
  insert into public.payment_orders (booking_id, user_id, method_code, idempotency_key, amount, currency, expires_at)
  values (reg.id, p_user, p_method, p_idempotency_key, reg.amount, reg.currency, exp)
  returning * into ord;

  update public.registrations
     set status = 'PENDING_PAYMENT', reserved_until = greatest(reserved_until, exp + interval '5 minutes')
   where id = reg.id;
  return ord;
end $$;
revoke all on function public.create_payment_order(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.create_payment_order(uuid,uuid,text,text) to service_role;

-- ---------------------------------------------------------------- verified success -> booking confirmation (one transaction)
-- Called only after TRUSTED verification (provider status API / signed webhook / admin-verified bank credit).
create or replace function public.finalize_payment_success(
  p_order uuid, p_provider_txn text, p_amount numeric, p_currency text, p_provider_status text, p_verified_by uuid default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  ord public.payment_orders;
  reg public.registrations;
  m public.tournament_modes;
  booked int;
  title text;
begin
  select * into ord from public.payment_orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if ord.status in ('SUCCESS','REFUND_PENDING','REFUNDED') then return 'ALREADY_SUCCESS'; end if;   -- replayed webhook
  if ord.status = 'REJECTED' then return 'ORDER_REJECTED'; end if;

  if p_amount is distinct from ord.amount or p_currency is distinct from ord.currency then
    insert into public.payment_reconciliation_logs (payment_order_id, provider, expected_amount, observed_amount,
                                                    observed_status, reconciliation_status, notes, checked_by)
    values (ord.id, ord.method_code, ord.amount, p_amount, p_provider_status, 'MISMATCH',
            'amount/currency mismatch: expected ' || ord.amount || ' ' || ord.currency || ', got ' || coalesce(p_amount::text,'null') || ' ' || coalesce(p_currency,'null'),
            p_verified_by);
    if public.payment_transition_allowed(ord.status, 'RECONCILIATION_REQUIRED') then
      update public.payment_orders set status = 'RECONCILIATION_REQUIRED', provider_raw_status = p_provider_status where id = ord.id;
    end if;
    return 'RECONCILIATION_REQUIRED';
  end if;

  select * into reg from public.registrations where id = ord.booking_id for update;
  select * into m from public.tournament_modes where id = reg.tournament_mode_id for update;

  -- Late money for an attempt we had already closed: route through reconciliation first.
  begin
    if ord.status in ('EXPIRED','FAILED','CANCELLED') then
      update public.payment_orders set status = 'RECONCILIATION_REQUIRED' where id = ord.id;
    elsif ord.status = 'CREATED' then
      update public.payment_orders set status = 'PENDING' where id = ord.id;
    end if;
  exception when unique_violation then
    insert into public.payment_reconciliation_logs (payment_order_id, provider, expected_amount, observed_amount,
                                                    observed_status, reconciliation_status, notes, checked_by)
    values (ord.id, ord.method_code, ord.amount, p_amount, p_provider_status, 'MISMATCH',
            'verified payment arrived for a closed attempt while a newer attempt is active: manual review needed', p_verified_by);
    return 'MANUAL_REVIEW_REQUIRED';
  end;

  if reg.status in ('EXPIRED') then
    -- Slot was released. Re-take it only if it is still free and the UIDs are still unique.
    select count(*) into booked from public.registrations
     where tournament_mode_id = m.id and status in ('RESERVED','PENDING_PAYMENT','CONFIRMED','HELD');
    if booked >= m.total_slots then reg.status := 'CANCELLED'; end if;
  end if;
  if reg.status = 'CANCELLED' then
    update public.payment_orders set status = 'RECONCILIATION_REQUIRED', provider_raw_status = p_provider_status
     where id = ord.id and status <> 'RECONCILIATION_REQUIRED';
    insert into public.payment_reconciliation_logs (payment_order_id, provider, expected_amount, observed_amount,
                                                    observed_status, reconciliation_status, notes, checked_by)
    values (ord.id, ord.method_code, ord.amount, p_amount, p_provider_status, 'MISMATCH',
            'verified payment received but the slot is no longer available: refund or manual placement required', p_verified_by);
    return 'RECONCILIATION_REQUIRED';
  end if;

  if reg.status = 'EXPIRED' then
    begin
      update public.registration_players set active = true where registration_id = reg.id;
    exception when unique_violation then
      update public.payment_orders set status = 'RECONCILIATION_REQUIRED', provider_raw_status = p_provider_status
       where id = ord.id and status <> 'RECONCILIATION_REQUIRED';
      insert into public.payment_reconciliation_logs (payment_order_id, provider, expected_amount, observed_amount,
                                                      observed_status, reconciliation_status, notes, checked_by)
      values (ord.id, ord.method_code, ord.amount, p_amount, p_provider_status, 'MISMATCH',
              'verified payment received but a player UID was registered elsewhere meanwhile', p_verified_by);
      return 'RECONCILIATION_REQUIRED';
    end;
  end if;

  insert into public.payment_transactions (payment_order_id, method_code, provider_transaction_id, provider_payment_status,
                                           amount, currency, verified_by)
  values (ord.id, ord.method_code, p_provider_txn, p_provider_status, ord.amount, ord.currency, p_verified_by);

  update public.payment_orders set status = 'SUCCESS', provider_raw_status = p_provider_status where id = ord.id;
  update public.registrations set status = 'CONFIRMED', confirmed_at = now(), reserved_until = null where id = reg.id;

  select t.title into title from public.tournaments t where t.id = reg.tournament_id;
  insert into public.notifications (user_id, kind, title, body, link)
  values (reg.user_id, 'REGISTRATION', 'Payment verified - slot confirmed', title || ' (' || reg.booking_code || ')', '/dashboard');
  insert into public.email_queue (template, recipient_user, to_email, subject, payload, dedupe_key)
  values ('REGISTRATION_CONFIRMATION', reg.user_id, reg.contact_email, 'Registration confirmed: ' || title,
          jsonb_build_object('registration_id', reg.id), 'reg-confirm:' || reg.id)
  on conflict (dedupe_key) do nothing;
  return 'CONFIRMED';
end $$;
revoke all on function public.finalize_payment_success(uuid,text,numeric,text,text,uuid) from public, anon, authenticated;
grant execute on function public.finalize_payment_success(uuid,text,numeric,text,text,uuid) to service_role;

-- ---------------------------------------------------------------- manual UPI
-- Submission only records evidence and moves the order to PAYMENT_UNDER_REVIEW. It NEVER confirms a booking.
create or replace function public.submit_manual_upi(
  p_user uuid, p_order uuid, p_utr text, p_payer text, p_amount numeric, p_paid_at timestamptz, p_proof_path text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  ord public.payment_orders;
  sub public.manual_upi_submissions;
  new_id uuid;
begin
  select * into ord from public.payment_orders where id = p_order for update;
  if not found or ord.user_id <> p_user or ord.method_code <> 'MANUAL_UPI' then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.payment_method_available('MANUAL_UPI') then raise exception 'METHOD_UNAVAILABLE' using errcode = 'P0001'; end if;
  if (select count(*) from public.manual_upi_submissions
       where user_id = p_user and submitted_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001'; end if;

  select * into sub from public.manual_upi_submissions
   where payment_order_id = ord.id and review_status = 'NEEDS_CLARIFICATION' for update;
  if found then   -- player is answering a clarification request
    update public.manual_upi_submissions
       set utr_reference = p_utr, payer_display_name = p_payer, submitted_amount = p_amount, paid_at = p_paid_at,
           proof_storage_path = coalesce(p_proof_path, proof_storage_path), review_status = 'PENDING',
           review_reason = null, submitted_at = now()
     where id = sub.id returning id into new_id;
    return new_id;
  end if;

  if ord.status <> 'CREATED' then raise exception 'ORDER_NOT_SUBMITTABLE' using errcode = 'P0001'; end if;
  if ord.expires_at < now() then raise exception 'ORDER_EXPIRED' using errcode = 'P0001'; end if;

  begin
    insert into public.manual_upi_submissions (payment_order_id, booking_id, user_id, utr_reference, payer_display_name,
                                               submitted_amount, paid_at, proof_storage_path)
    values (ord.id, ord.booking_id, p_user, p_utr, p_payer, p_amount, p_paid_at, p_proof_path)
    returning id into new_id;
  exception when unique_violation then
    raise exception 'UTR_ALREADY_SUBMITTED' using errcode = 'P0001';
  end;
  update public.payment_orders set status = 'PAYMENT_UNDER_REVIEW' where id = ord.id;

  insert into public.notifications (user_id, kind, title, body, link)
  select distinct r.user_id, 'PAYMENT_REVIEW', 'Manual UPI payment awaiting review', 'Open the review queue.', '/admin/manual-upi'
    from public.admin_roles r where r.role in ('PAYMENT_REVIEWER','SUPER_ADMIN') and r.user_id <> p_user;
  return new_id;
end $$;
revoke all on function public.submit_manual_upi(uuid,uuid,text,text,numeric,timestamptz,text) from public, anon, authenticated;
grant execute on function public.submit_manual_upi(uuid,uuid,text,text,numeric,timestamptz,text) to service_role;

-- Reviewer decision. APPROVE requires the reviewer to attest that the credit was seen in the merchant bank/UPI records.
create or replace function public.review_manual_upi(
  p_submission uuid, p_decision text, p_reason text, p_credit_verified boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare
  sub public.manual_upi_submissions;
  ord public.payment_orders;
  res text;
begin
  if not public.has_role(array['PAYMENT_REVIEWER']) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_decision not in ('APPROVE','REJECT','CLARIFY') then raise exception 'INVALID_DECISION' using errcode = 'P0001'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;

  select * into sub from public.manual_upi_submissions where id = p_submission for update;
  if not found then raise exception 'SUBMISSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if sub.review_status <> 'PENDING' then raise exception 'ALREADY_REVIEWED' using errcode = 'P0001'; end if;
  if sub.user_id = auth.uid() then raise exception 'CONFLICT_OF_INTEREST' using errcode = 'P0001'; end if;
  select * into ord from public.payment_orders where id = sub.payment_order_id for update;

  if p_decision = 'APPROVE' then
    if not coalesce(p_credit_verified, false) then raise exception 'CREDIT_NOT_VERIFIED' using errcode = 'P0001'; end if;
    if sub.submitted_amount is not null and sub.submitted_amount <> ord.amount then
      raise exception 'AMOUNT_MISMATCH' using errcode = 'P0001'; end if;
    res := public.finalize_payment_success(ord.id, upper(sub.utr_reference), ord.amount, ord.currency, 'MANUAL_APPROVED', auth.uid());
    if res <> 'CONFIRMED' then raise exception 'APPROVAL_FAILED:%', res using errcode = 'P0001'; end if;   -- rolls everything back
    update public.manual_upi_submissions
       set review_status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = p_reason
     where id = sub.id;
  elsif p_decision = 'REJECT' then
    update public.manual_upi_submissions
       set review_status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = p_reason
     where id = sub.id;
    update public.payment_orders set status = 'REJECTED' where id = ord.id;
    insert into public.notifications (user_id, kind, title, body, link)
    values (sub.user_id, 'PAYMENT', 'Manual payment rejected', p_reason, '/dashboard');
    res := 'REJECTED';
  else
    update public.manual_upi_submissions
       set review_status = 'NEEDS_CLARIFICATION', review_reason = p_reason, assigned_reviewer = auth.uid()
     where id = sub.id;
    insert into public.notifications (user_id, kind, title, body, link)
    values (sub.user_id, 'PAYMENT', 'More information needed for your payment', p_reason, '/dashboard');
    res := 'CLARIFICATION_REQUESTED';
  end if;

  perform public.write_audit('manual_upi.' || lower(p_decision), 'manual_upi_submission', sub.id::text,
                             jsonb_build_object('review_status', sub.review_status),
                             jsonb_build_object('result', res, 'order', ord.id, 'utr', sub.utr_reference), p_reason);
  return res;
end $$;
revoke all on function public.review_manual_upi(uuid,text,text,boolean) from public, anon;
grant execute on function public.review_manual_upi(uuid,text,text,boolean) to authenticated;

-- ---------------------------------------------------------------- admin payment configuration (logged, super admin only)
create or replace function public.admin_update_payment_method(p_method text, p_patch jsonb, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  old_row public.payment_method_settings;
  new_row public.payment_method_settings;
  k text;
begin
  if not public.has_role(array[]::text[]) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into old_row from public.payment_method_settings where method_code = p_method for update;
  if not found then raise exception 'UNKNOWN_METHOD' using errcode = 'P0001'; end if;

  -- credentials never go into public config; players' PIN/OTP/card data is never collected at all
  for k in select jsonb_object_keys(coalesce(p_patch->'config_public','{}'::jsonb)) loop
    if k ~* '(secret|passw|pin|otp|token|cvv|card|salt|private)' then
      raise exception 'SECRET_KEY_NOT_ALLOWED_IN_CONFIG: %', k using errcode = 'P0001'; end if;
  end loop;

  if coalesce((p_patch->>'enabled')::boolean, false) and
     coalesce(p_patch->>'compliance_approval_status', old_row.compliance_approval_status) <> 'APPROVED' then
    raise exception 'COMPLIANCE_NOT_APPROVED' using errcode = 'P0001'; end if;

  if coalesce((p_patch->>'is_primary_automatic')::boolean, false) then
    if p_method not in ('PHONEPE','RAZORPAY') then raise exception 'ONLY_AUTOMATIC_CAN_BE_PRIMARY' using errcode = 'P0001'; end if;
    update public.payment_method_settings set is_primary_automatic = false where is_primary_automatic and method_code <> p_method;
    update public.payment_global_settings set primary_automatic_gateway = p_method, updated_by = auth.uid(), updated_at = now();
  end if;

  update public.payment_method_settings s set
    enabled = coalesce((p_patch->>'enabled')::boolean, s.enabled),
    is_primary_automatic = coalesce((p_patch->>'is_primary_automatic')::boolean, s.is_primary_automatic),
    environment = coalesce(p_patch->>'environment', s.environment),
    display_name = coalesce(p_patch->>'display_name', s.display_name),
    public_instructions = coalesce(p_patch->>'public_instructions', s.public_instructions),
    compliance_approval_status = coalesce(p_patch->>'compliance_approval_status', s.compliance_approval_status),
    config_public = s.config_public || coalesce(p_patch->'config_public', '{}'::jsonb),
    updated_by = auth.uid()
  where s.method_code = p_method
  returning * into new_row;

  -- an unapproved method cannot stay enabled
  if new_row.compliance_approval_status <> 'APPROVED' and new_row.enabled then
    update public.payment_method_settings set enabled = false where method_code = p_method returning * into new_row;
  end if;

  insert into public.gateway_activity_logs (provider_or_method, action, old_value, new_value, admin_id, reason)
  values (p_method, 'UPDATE_METHOD_SETTINGS', to_jsonb(old_row), to_jsonb(new_row), auth.uid(), p_reason);
  perform public.write_audit('payment_method.update', 'payment_method_settings', p_method, to_jsonb(old_row), to_jsonb(new_row), p_reason);
end $$;
revoke all on function public.admin_update_payment_method(text,jsonb,text) from public, anon;
grant execute on function public.admin_update_payment_method(text,jsonb,text) to authenticated;

create or replace function public.admin_update_payment_global(p_patch jsonb, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  old_row public.payment_global_settings;
  new_status text;
  new_paid boolean;
begin
  if not public.has_role(array[]::text[]) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into old_row from public.payment_global_settings for update;

  new_status := coalesce(p_patch->>'compliance_status', old_row.compliance_status);
  new_paid := coalesce((p_patch->>'paid_entry_enabled')::boolean, old_row.paid_entry_enabled);
  if new_status = 'APPROVED' and old_row.compliance_status <> 'APPROVED'
     and btrim(coalesce(p_patch->>'compliance_reviewer','')) = '' then
    raise exception 'COMPLIANCE_REVIEWER_REQUIRED' using errcode = 'P0001'; end if;
  if new_status <> 'APPROVED' then
    new_paid := false;                                  -- withdrawing approval always switches paid entry off
  elsif coalesce((p_patch->>'paid_entry_enabled')::boolean, false) and old_row.compliance_status <> 'APPROVED'
        and btrim(coalesce(p_patch->>'compliance_reviewer','')) = '' then
    raise exception 'COMPLIANCE_REVIEWER_REQUIRED' using errcode = 'P0001';
  end if;

  update public.payment_global_settings set
    paid_entry_enabled = new_paid,
    free_entry_enabled = coalesce((p_patch->>'free_entry_enabled')::boolean, free_entry_enabled),
    attempt_expiry_minutes = coalesce((p_patch->>'attempt_expiry_minutes')::int, attempt_expiry_minutes),
    min_amount = case when p_patch ? 'min_amount' then (p_patch->>'min_amount')::numeric else min_amount end,
    max_amount = case when p_patch ? 'max_amount' then (p_patch->>'max_amount')::numeric else max_amount end,
    refund_policy_text = coalesce(p_patch->>'refund_policy_text', refund_policy_text),
    support_contact = coalesce(p_patch->>'support_contact', support_contact),
    maintenance_message = coalesce(p_patch->>'maintenance_message', maintenance_message),
    compliance_status = new_status,
    compliance_reviewer = case when new_status = 'APPROVED' then coalesce(p_patch->>'compliance_reviewer', compliance_reviewer) else compliance_reviewer end,
    compliance_note = coalesce(p_patch->>'compliance_note', compliance_note),
    compliance_approved_at = case when new_status = 'APPROVED' and old_row.compliance_status <> 'APPROVED' then now()
                                  when new_status <> 'APPROVED' then null else compliance_approved_at end,
    updated_by = auth.uid(), updated_at = now();

  -- withdrawing approval switches the whole paid flow off
  if new_status <> 'APPROVED' then
    update public.payment_global_settings set paid_entry_enabled = false;
    update public.payment_method_settings set enabled = false where enabled;
  end if;

  insert into public.gateway_activity_logs (provider_or_method, action, old_value, new_value, admin_id, reason)
  values ('GLOBAL', 'UPDATE_GLOBAL_SETTINGS', to_jsonb(old_row), (select to_jsonb(g) from public.payment_global_settings g), auth.uid(), p_reason);
  perform public.write_audit('payment_global.update', 'payment_global_settings', 'global', to_jsonb(old_row),
                             (select to_jsonb(g) from public.payment_global_settings g), p_reason);
end $$;
revoke all on function public.admin_update_payment_global(jsonb,text) from public, anon;
grant execute on function public.admin_update_payment_global(jsonb,text) to authenticated;

-- ---------------------------------------------------------------- access helpers used by RLS
create or replace function public.can_view_room(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.email_verified and p.status = 'ACTIVE')
     and exists (select 1 from public.registrations r
                  where r.user_id = auth.uid() and r.tournament_id = p_tournament and r.status = 'CONFIRMED');
$$;

-- Team edits: leader only, before the tournament's change deadline, and never after the match starts.
create or replace function public.team_editable(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams t where t.id = p_team and t.leader_id = auth.uid())
     and not exists (
       select 1 from public.registrations r join public.tournaments tr on tr.id = r.tournament_id
        where r.team_id = p_team and r.status in ('RESERVED','PENDING_PAYMENT','CONFIRMED','HELD')
          and (now() >= tr.team_change_deadline or now() >= tr.starts_at));
$$;

-- Edge Functions run as service_role; make the grants explicit instead of relying on platform defaults.
grant execute on function public.write_audit(text,text,text,jsonb,jsonb,text) to service_role;
grant execute on function public.payment_method_available(text) to service_role;
