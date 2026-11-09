-- 0005_storage.sql - buckets and policies (Supabase storage schema)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('banners','banners',true,5242880,array['image/png','image/jpeg','image/webp']),
  ('avatars','avatars',true,2097152,array['image/png','image/jpeg','image/webp']),
  ('payment-proofs','payment-proofs',false,5242880,array['image/png','image/jpeg','image/webp','application/pdf']),
  ('payment-assets','payment-assets',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy banners_read on storage.objects for select using (bucket_id in ('banners','avatars','payment-assets'));
create policy banners_admin on storage.objects for all to authenticated
  using (bucket_id in ('banners','payment-assets') and public.has_role(array['TOURNAMENT_MANAGER']))
  with check (bucket_id in ('banners','payment-assets') and public.has_role(array['TOURNAMENT_MANAGER']));
create policy avatars_own on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
-- proofs: players upload into their own folder and read only their own; reviewers read all. No update/delete by players.
create policy proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role(array['PAYMENT_REVIEWER'])));
