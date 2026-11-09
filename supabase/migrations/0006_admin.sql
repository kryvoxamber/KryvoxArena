-- 0006_admin.sql - audited admin operations (all SECURITY DEFINER, role-checked, reason required, written to admin_audit_logs).

-- Generic audit trigger for staff content edits made directly through RLS-protected tables.
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.is_staff() then
    insert into public.admin_audit_logs (actor_id, action, entity, entity_id, old_value, new_value, reason)
    values (auth.uid(), lower(tg_op) || '.' || tg_table_name, tg_table_name,
            coalesce((to_jsonb(coalesce(new, old)) ->> 'id'), (to_jsonb(coalesce(new, old)) ->> 'key')),
            case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end, null);
  end if;
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['tournaments','tournament_modes','tournament_rules','matches','room_credentials','banners','announcements','site_settings'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', 'audit_' || t, t);
  end loop;
end $$;

-- Republishing changed room credentials bumps the version so players/emails can tell the update from the original.
create or replace function public.room_version_bump() returns trigger language plpgsql as $$
begin
  if new.status = 'PUBLISHED' and old.status <> 'PUBLISHED' then new.published_at := now(); end if;
  if old.status = 'PUBLISHED' and new.status = 'PUBLISHED' and (new.room_id <> old.room_id or new.room_password <> old.room_password) then
    new.version := old.version + 1; new.published_at := now(); end if;
  return new;
end $$;
create trigger room_version before update on public.room_credentials for each row execute function public.room_version_bump();

-- ---------------------------------------------------------------- registrations / teams
create or replace function public.admin_set_registration_status(p_reg uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.registrations;
begin
  if not public.has_role(array['TOURNAMENT_MANAGER']) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if p_status not in ('HELD','CANCELLED','CONFIRMED') then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  select * into r from public.registrations where id = p_reg for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  -- CONFIRMED is only a way to lift a hold; money-based confirmation happens exclusively through verified payments.
  if p_status = 'CONFIRMED' and r.status <> 'HELD' then raise exception 'ONLY_HELD_CAN_BE_CONFIRMED' using errcode = 'P0001'; end if;
  if r.status in ('CANCELLED','EXPIRED') then raise exception 'ALREADY_CLOSED' using errcode = 'P0001'; end if;
  update public.registrations set status = p_status, reserved_until = null where id = p_reg;
  if p_status = 'CANCELLED' then update public.registration_players set active = false where registration_id = p_reg; end if;
  perform public.write_audit('registration.' || lower(p_status), 'registration', p_reg::text, jsonb_build_object('status', r.status), jsonb_build_object('status', p_status), p_reason);
end $$;

create or replace function public.admin_edit_team_member(p_member uuid, p_patch jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.team_members; n public.team_members;
begin
  if not public.has_role(array['TOURNAMENT_MANAGER','SUPPORT_MANAGER']) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into m from public.team_members where id = p_member for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if p_patch ? 'game_uid' and (p_patch->>'game_uid') !~ '^[0-9]{6,15}$' then raise exception 'INVALID_UID' using errcode = 'P0001'; end if;
  update public.team_members set
    full_name = coalesce(nullif(btrim(p_patch->>'full_name'),''), full_name),
    ingame_name = coalesce(nullif(btrim(p_patch->>'ingame_name'),''), ingame_name),
    game_uid = coalesce(p_patch->>'game_uid', game_uid)
  where id = p_member returning * into n;
  if n.game_uid <> m.game_uid then
    begin
      update public.registration_players p set game_uid = n.game_uid
       from public.registrations r where r.id = p.registration_id and r.team_id = m.team_id and p.game_uid = m.game_uid and p.active;
    exception when unique_violation then raise exception 'UID_ALREADY_REGISTERED' using errcode = 'P0001'; end;
  end if;
  insert into public.team_change_logs (team_id, changed_by, change, old_value, new_value, is_admin_override, reason)
  values (m.team_id, auth.uid(), 'member_edit', to_jsonb(m), to_jsonb(n), true, p_reason);
  perform public.write_audit('team_member.edit', 'team_member', p_member::text, to_jsonb(m), to_jsonb(n), p_reason);
end $$;

-- ---------------------------------------------------------------- results + leaderboard
create or replace function public.recompute_leaderboard() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.leaderboard_entries;
  insert into public.leaderboard_entries (scope, tournament_id, game, mode, team_id, team_name, country, state, points, kills, wins, matches_played)
  select 'TOURNAMENT', t.id, t.game, m.mode, r.team_id, tm.name, max(r.country), max(r.state),
         sum(mr.points), sum(mr.kills), count(*) filter (where mr.is_winner), count(*)
    from public.match_results mr
    join public.registrations r on r.id = mr.registration_id
    join public.tournaments t on t.id = r.tournament_id
    join public.tournament_modes m on m.id = r.tournament_mode_id
    join public.teams tm on tm.id = r.team_id
   where mr.published and r.status = 'CONFIRMED'
   group by t.id, t.game, m.mode, r.team_id, tm.name;
  insert into public.leaderboard_entries (scope, tournament_id, game, mode, team_id, team_name, country, state, points, kills, wins, matches_played)
  select 'OVERALL', null, game, mode, team_id, team_name, max(country), max(state), sum(points), sum(kills), sum(wins), sum(matches_played)
    from public.leaderboard_entries where scope = 'TOURNAMENT' group by game, mode, team_id, team_name;
end $$;
revoke all on function public.recompute_leaderboard() from public, anon, authenticated;
grant execute on function public.recompute_leaderboard() to service_role;

create or replace function public.admin_save_result(p_match uuid, p_registration uuid, p_placement int, p_kills int, p_proof text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare mt public.matches; tr public.tournaments; reg public.registrations; pts numeric; plc jsonb; old_row public.match_results; new_row public.match_results;
begin
  if not public.has_role(array['RESULT_MANAGER']) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into mt from public.matches where id = p_match; if not found then raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into tr from public.tournaments where id = mt.tournament_id;
  select * into reg from public.registrations where id = p_registration;
  if not found or reg.tournament_id <> mt.tournament_id or reg.status <> 'CONFIRMED' then raise exception 'REGISTRATION_NOT_ELIGIBLE' using errcode = 'P0001'; end if;
  if p_placement < 1 or p_kills < 0 then raise exception 'INVALID_VALUES' using errcode = 'P0001'; end if;
  if exists (select 1 from public.match_results where match_id = p_match and placement = p_placement and registration_id <> p_registration) then
    raise exception 'DUPLICATE_PLACEMENT' using errcode = 'P0001'; end if;
  plc := tr.scoring_rules -> 'placement';
  pts := coalesce((plc ->> (p_placement - 1))::numeric, 0) + p_kills * coalesce((tr.scoring_rules ->> 'per_kill')::numeric, 1);
  select * into old_row from public.match_results where match_id = p_match and registration_id = p_registration;
  insert into public.match_results (match_id, registration_id, placement, kills, points, is_winner, proof_url, match_date, entered_by)
  values (p_match, p_registration, p_placement, p_kills, pts, p_placement = 1, p_proof, (mt.scheduled_at at time zone 'Asia/Kolkata')::date, auth.uid())
  on conflict (match_id, registration_id) do update
    set placement = excluded.placement, kills = excluded.kills, points = excluded.points, is_winner = excluded.is_winner,
        proof_url = coalesce(excluded.proof_url, public.match_results.proof_url), entered_by = auth.uid()
  returning * into new_row;
  perform public.write_audit('result.save', 'match_result', new_row.id::text, to_jsonb(old_row), to_jsonb(new_row), 'result entry');
  if new_row.published then perform public.recompute_leaderboard(); end if;   -- corrections to published results are reflected immediately
  return pts;
end $$;

create or replace function public.admin_publish_results(p_match uuid, p_publish boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['RESULT_MANAGER']) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if p_publish and not exists (select 1 from public.match_results where match_id = p_match) then raise exception 'NO_RESULTS' using errcode = 'P0001'; end if;
  update public.match_results set published = p_publish where match_id = p_match;
  update public.matches set status = case when p_publish then 'COMPLETED' else 'LIVE' end where id = p_match;
  perform public.recompute_leaderboard();
  perform public.write_audit(case when p_publish then 'result.publish' else 'result.unpublish' end, 'match', p_match::text, null, jsonb_build_object('published', p_publish), p_reason);
end $$;

-- ---------------------------------------------------------------- users / staff
create or replace function public.admin_set_user_status(p_user uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare old_s text;
begin
  if not public.has_role(array['SUPPORT_MANAGER']) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if p_status not in ('ACTIVE','SUSPENDED','BANNED') then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  if p_user = auth.uid() then raise exception 'CANNOT_CHANGE_SELF' using errcode = 'P0001'; end if;
  select status into old_s from public.profiles where id = p_user; if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  update public.profiles set status = p_status where id = p_user;
  perform public.write_audit('user.status', 'profile', p_user::text, jsonb_build_object('status', old_s), jsonb_build_object('status', p_status), p_reason);
end $$;

create or replace function public.admin_set_role(p_email text, p_role text, p_grant boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.has_role(array[]::text[]) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select id into uid from public.profiles where lower(email) = lower(btrim(p_email));
  if uid is null then raise exception 'USER_NOT_FOUND' using errcode = 'P0001'; end if;
  if p_grant then
    insert into public.admin_roles (user_id, role, granted_by) values (uid, p_role, auth.uid()) on conflict (user_id, role) do nothing;
  else
    if p_role = 'SUPER_ADMIN' and (select count(*) from public.admin_roles where role = 'SUPER_ADMIN') <= 1 then
      raise exception 'LAST_SUPER_ADMIN' using errcode = 'P0001'; end if;
    delete from public.admin_roles where user_id = uid and role = p_role;
  end if;
  perform public.write_audit(case when p_grant then 'role.grant' else 'role.revoke' end, 'admin_role', uid::text, null, jsonb_build_object('role', p_role), p_reason);
end $$;

-- ---------------------------------------------------------------- refunds (record-keeping; money moves in the provider/bank, then is verified here)
create or replace function public.admin_record_refund(p_txn uuid, p_reference text, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.payment_transactions; rid uuid;
begin
  if not public.has_role(array['PAYMENT_REVIEWER']) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason,'')) = '' or btrim(coalesce(p_reference,'')) = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into t from public.payment_transactions where id = p_txn; if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if p_amount <= 0 or p_amount > t.amount then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode = 'P0001'; end if;
  insert into public.refund_records (payment_transaction_id, refund_reference, amount, reason, initiated_by) values (p_txn, btrim(p_reference), p_amount, p_reason, auth.uid()) returning id into rid;
  update public.payment_orders set status = 'REFUND_PENDING' where id = t.payment_order_id and status = 'SUCCESS';
  perform public.write_audit('refund.record', 'refund_record', rid::text, null, jsonb_build_object('amount', p_amount, 'reference', p_reference), p_reason);
  return rid;
end $$;

create or replace function public.admin_complete_refund(p_refund uuid, p_independently_verified boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare f public.refund_records; t public.payment_transactions;
begin
  if not public.has_role(array['PAYMENT_REVIEWER']) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not coalesce(p_independently_verified, false) then raise exception 'REFUND_NOT_VERIFIED' using errcode = 'P0001'; end if;
  select * into f from public.refund_records where id = p_refund for update; if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if f.status <> 'PENDING' then raise exception 'ALREADY_CLOSED' using errcode = 'P0001'; end if;
  select * into t from public.payment_transactions where id = f.payment_transaction_id;
  update public.refund_records set status = 'SUCCESS', independently_verified = true where id = p_refund;
  if f.amount = t.amount then
    update public.payment_orders set status = 'REFUNDED' where id = t.payment_order_id and status = 'REFUND_PENDING';
    update public.registrations set status = 'CANCELLED' where id = (select booking_id from public.payment_orders where id = t.payment_order_id) and status = 'CONFIRMED';
    update public.registration_players set active = false where registration_id = (select booking_id from public.payment_orders where id = t.payment_order_id);
  else
    update public.payment_orders set status = 'SUCCESS' where id = t.payment_order_id and status = 'REFUND_PENDING';   -- partial refund: booking stays
  end if;
  perform public.write_audit('refund.complete', 'refund_record', p_refund::text, null, jsonb_build_object('status', 'SUCCESS'), p_reason);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'admin_set_registration_status(uuid,text,text)','admin_edit_team_member(uuid,jsonb,text)','admin_save_result(uuid,uuid,int,int,text)',
    'admin_publish_results(uuid,boolean,text)','admin_set_user_status(uuid,text,text)','admin_set_role(text,text,boolean,text)',
    'admin_record_refund(uuid,text,numeric,text)','admin_complete_refund(uuid,boolean,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
