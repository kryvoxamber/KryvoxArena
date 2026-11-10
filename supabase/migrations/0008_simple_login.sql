-- 0008: login is now plain email+password / Google (no custom email OTP step).
-- profiles.email_verified stays server-controlled (clients still cannot write it) but is set automatically at signup,
-- so every existing booking/room rule keeps working unchanged. Turn on Supabase "Confirm email" in the dashboard if you
-- also want a confirmation link (that is Supabase's own feature, not an OTP screen in this app).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, email_verified, email_verified_at)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.raw_user_meta_data->>'avatar_url', true, now())
  on conflict (id) do nothing;
  return new;
end $$;
update public.profiles set email_verified = true, email_verified_at = coalesce(email_verified_at, now()) where not email_verified;
