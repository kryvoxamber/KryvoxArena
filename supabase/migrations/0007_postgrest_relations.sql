-- 0007: PostgREST can only embed related tables (e.g. select "*, profiles(email)") across foreign keys that exist in the
-- public schema. These columns referenced auth.users only, so the admin Staff and Manual-UPI pages could not load names/emails.
alter table public.admin_roles
  add constraint admin_roles_user_profile_fk foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.manual_upi_submissions
  add constraint manual_upi_user_profile_fk foreign key (user_id) references public.profiles(id);
alter table public.registrations
  add constraint registrations_user_profile_fk foreign key (user_id) references public.profiles(id);
notify pgrst, 'reload schema';
