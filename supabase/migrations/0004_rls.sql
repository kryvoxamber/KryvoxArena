-- 0004_rls.sql - Row Level Security. Default deny; payments/registrations have NO client write path.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---- profiles: own row; only safe columns writable (email_verified etc. are server-controlled)
grant select on public.profiles to authenticated;
grant update (full_name, phone, country, state, city, avatar_url) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---- admin_roles / audit / OTP: staff read only, writes via service role
grant select on public.admin_roles to authenticated;
create policy admin_roles_self on public.admin_roles for select to authenticated using (user_id = auth.uid() or public.has_role(array[]::text[]));
grant select on public.admin_audit_logs to authenticated;
create policy audit_read on public.admin_audit_logs for select to authenticated using (public.has_role(array[]::text[]));

-- ---- public content
grant select on public.tournaments, public.tournament_modes, public.tournament_rules, public.matches,
  public.leaderboard_entries, public.banners, public.announcements, public.site_settings to anon, authenticated;
create policy tournaments_pub on public.tournaments for select using (status in ('PUBLISHED','LIVE','COMPLETED') or public.is_staff());
create policy modes_pub on public.tournament_modes for select using (
  exists (select 1 from public.tournaments t where t.id = tournament_id and t.status in ('PUBLISHED','LIVE','COMPLETED')) or public.is_staff());
create policy rules_pub on public.tournament_rules for select using (published or public.is_staff());
create policy matches_pub on public.matches for select using (
  exists (select 1 from public.tournaments t where t.id = tournament_id and t.status in ('PUBLISHED','LIVE','COMPLETED')) or public.is_staff());
create policy lb_pub on public.leaderboard_entries for select using (true);
create policy banners_pub on public.banners for select using (
  (enabled and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now())) or public.is_staff());
create policy ann_pub on public.announcements for select using (
  (published and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now())) or public.is_staff());
create policy settings_pub on public.site_settings for select using (is_public or public.is_staff());
grant select on public.tournament_mode_availability to anon, authenticated;
grant select on public.match_results to anon, authenticated;
create policy results_pub on public.match_results for select using (published or public.is_staff());

-- staff content management (granular roles)
grant insert, update, delete on public.tournaments, public.tournament_modes, public.tournament_rules, public.matches,
  public.banners, public.announcements, public.site_settings, public.leaderboard_entries, public.match_results to authenticated;
create policy tournaments_w on public.tournaments for all to authenticated using (public.has_role(array['TOURNAMENT_MANAGER'])) with check (public.has_role(array['TOURNAMENT_MANAGER']));
create policy modes_w on public.tournament_modes for all to authenticated using (public.has_role(array['TOURNAMENT_MANAGER'])) with check (public.has_role(array['TOURNAMENT_MANAGER']));
create policy rules_w on public.tournament_rules for all to authenticated using (public.has_role(array['TOURNAMENT_MANAGER'])) with check (public.has_role(array['TOURNAMENT_MANAGER']));
create policy matches_w on public.matches for all to authenticated using (public.has_role(array['TOURNAMENT_MANAGER','RESULT_MANAGER'])) with check (public.has_role(array['TOURNAMENT_MANAGER','RESULT_MANAGER']));
create policy banners_w on public.banners for all to authenticated using (public.has_role(array['TOURNAMENT_MANAGER'])) with check (public.has_role(array['TOURNAMENT_MANAGER']));
create policy ann_w on public.announcements for all to authenticated using (public.has_role(array['TOURNAMENT_MANAGER','SUPPORT_MANAGER'])) with check (public.has_role(array['TOURNAMENT_MANAGER','SUPPORT_MANAGER']));
create policy settings_w on public.site_settings for all to authenticated using (public.has_role(array[]::text[])) with check (public.has_role(array[]::text[]));
create policy lb_w on public.leaderboard_entries for all to authenticated using (public.has_role(array['RESULT_MANAGER'])) with check (public.has_role(array['RESULT_MANAGER']));
create policy results_w on public.match_results for all to authenticated using (public.has_role(array['RESULT_MANAGER'])) with check (public.has_role(array['RESULT_MANAGER']));

-- ---- room credentials: only confirmed, verified registrants of that tournament, and only when published
grant select, insert, update, delete on public.room_credentials to authenticated;
create policy room_player on public.room_credentials for select to authenticated using (status = 'PUBLISHED' and public.can_view_room(tournament_id));
create policy room_staff on public.room_credentials for all to authenticated using (public.has_role(array['TOURNAMENT_MANAGER'])) with check (public.has_role(array['TOURNAMENT_MANAGER']));

-- ---- teams: leader/members read; leader edits only while team_editable()
grant select on public.teams, public.team_members to authenticated;
grant update (name) on public.teams to authenticated;
grant update (full_name, ingame_name, email, phone) on public.team_members to authenticated;
-- Helpers are SECURITY DEFINER so the two tables' policies do not call each other (that recursed infinitely).
create or replace function public.is_team_leader(p_team uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams t where t.id = p_team and t.leader_id = auth.uid()); $$;
create or replace function public.is_team_member(p_team uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members m where m.team_id = p_team and m.user_id = auth.uid()); $$;
create policy teams_read on public.teams for select to authenticated using (leader_id = auth.uid() or public.is_staff() or public.is_team_member(id));
create policy teams_upd on public.teams for update to authenticated using (public.team_editable(id)) with check (leader_id = auth.uid());
create policy tm_read on public.team_members for select to authenticated using (user_id = auth.uid() or public.is_staff() or public.is_team_leader(team_id));
create policy tm_upd on public.team_members for update to authenticated using (public.team_editable(team_id));
grant select on public.team_change_logs to authenticated;
create policy tcl_read on public.team_change_logs for select to authenticated using (public.is_staff());

-- ---- registrations: read own only; created exclusively through book_slot()
grant select on public.registrations, public.registration_players to authenticated;
create policy reg_read on public.registrations for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy regp_read on public.registration_players for select to authenticated using (
  exists (select 1 from public.registrations r where r.id = registration_id and (r.user_id = auth.uid() or public.is_staff())));

-- ---- notifications / reports
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notif_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_upd on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert on public.user_reports to authenticated;
create policy rep_read on public.user_reports for select to authenticated using (reporter_id = auth.uid() or public.has_role(array['SUPPORT_MANAGER']));
create policy rep_ins on public.user_reports for insert to authenticated with check (reporter_id = auth.uid());
grant update on public.user_reports to authenticated;
create policy rep_upd on public.user_reports for update to authenticated using (public.has_role(array['SUPPORT_MANAGER']));

-- ---- email: staff read; sending is server-side only
grant select on public.email_queue, public.email_logs to authenticated;
create policy eq_read on public.email_queue for select to authenticated using (public.has_role(array['EMAIL_MANAGER']));
create policy el_read on public.email_logs for select to authenticated using (public.has_role(array['EMAIL_MANAGER']));

-- ---- payments: players see own orders (no provider secrets exist in these tables); staff see all; NO client writes
grant select on public.payment_orders, public.payment_transactions, public.manual_upi_submissions to authenticated;
create policy po_read on public.payment_orders for select to authenticated using (user_id = auth.uid() or public.has_role(array['PAYMENT_REVIEWER']));
create policy pt_read on public.payment_transactions for select to authenticated using (
  exists (select 1 from public.payment_orders o where o.id = payment_order_id and (o.user_id = auth.uid() or public.has_role(array['PAYMENT_REVIEWER']))));
create policy mu_read on public.manual_upi_submissions for select to authenticated using (user_id = auth.uid() or public.has_role(array['PAYMENT_REVIEWER']));
grant select on public.payment_reconciliation_logs, public.gateway_activity_logs, public.refund_records, public.payment_webhook_events to authenticated;
create policy rl_read on public.payment_reconciliation_logs for select to authenticated using (public.has_role(array['PAYMENT_REVIEWER']));
create policy gl_read on public.gateway_activity_logs for select to authenticated using (public.has_role(array[]::text[]));
create policy rf_read on public.refund_records for select to authenticated using (public.has_role(array['PAYMENT_REVIEWER']));
create policy we_read on public.payment_webhook_events for select to authenticated using (public.has_role(array[]::text[]));

-- settings: players may see only safe public fields through these views, never the raw tables
create view public.payment_public_status with (security_invoker = false) as
  select g.paid_entry_enabled, g.free_entry_enabled, g.maintenance_message, g.refund_policy_text, g.support_contact,
         g.attempt_expiry_minutes
  from public.payment_global_settings g;
grant select on public.payment_public_status to anon, authenticated;
grant select on public.payment_global_settings, public.payment_method_settings to authenticated;
create policy pgs_read on public.payment_global_settings for select to authenticated using (public.has_role(array[]::text[]));
create policy pms_read on public.payment_method_settings for select to authenticated using (public.has_role(array[]::text[]));

-- player-safe list of usable methods (name + public instructions only)
create or replace function public.list_payment_methods() returns table(method_code text, display_name text, public_instructions text, is_primary_automatic boolean)
language sql stable security definer set search_path = public as $$
  select s.method_code, s.display_name, s.public_instructions, s.is_primary_automatic
  from public.payment_method_settings s where public.payment_method_available(s.method_code);
$$;
revoke all on function public.list_payment_methods() from public;
grant execute on function public.list_payment_methods() to anon, authenticated;
