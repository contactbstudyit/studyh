create or replace function public.admin_totp_aal2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1
      from auth.mfa_factors as factor
      where factor.user_id = (select auth.uid())
        and factor.factor_type = 'totp'
        and factor.status = 'verified'
    );
$$;

revoke all on function public.admin_totp_aal2() from public, anon;
grant execute on function public.admin_totp_aal2() to authenticated;

drop policy if exists "Require TOTP AAL2 for admin video access" on public.videos;
drop policy if exists "Require TOTP AAL2 for admin video reads" on public.videos;
drop policy if exists "Require TOTP AAL2 for admin video inserts" on public.videos;
drop policy if exists "Require TOTP AAL2 for admin video updates" on public.videos;
drop policy if exists "Require TOTP AAL2 for admin video deletes" on public.videos;
create policy "Require TOTP AAL2 for admin video reads"
  on public.videos
  as restrictive
  for select
  to authenticated
  using (
    not (select public.is_library_admin())
    or (select public.admin_totp_aal2())
    or published
  );
create policy "Require TOTP AAL2 for admin video inserts"
  on public.videos
  as restrictive
  for insert
  to authenticated
  with check (
    not (select public.is_library_admin())
    or (select public.admin_totp_aal2())
  );
create policy "Require TOTP AAL2 for admin video updates"
  on public.videos
  as restrictive
  for update
  to authenticated
  using (
    not (select public.is_library_admin())
    or (select public.admin_totp_aal2())
  )
  with check (
    not (select public.is_library_admin())
    or (select public.admin_totp_aal2())
  );
create policy "Require TOTP AAL2 for admin video deletes"
  on public.videos
  as restrictive
  for delete
  to authenticated
  using (
    not (select public.is_library_admin())
    or (select public.admin_totp_aal2())
  );

drop policy if exists "Require TOTP AAL2 for admin category access" on public.categories;
drop policy if exists "Require TOTP AAL2 for admin category inserts" on public.categories;
drop policy if exists "Require TOTP AAL2 for admin category updates" on public.categories;
drop policy if exists "Require TOTP AAL2 for admin category deletes" on public.categories;
create policy "Require TOTP AAL2 for admin category inserts"
  on public.categories
  as restrictive
  for insert
  to authenticated
  with check (
    not (select public.is_library_admin())
    or (select public.admin_totp_aal2())
  );
create policy "Require TOTP AAL2 for admin category updates"
  on public.categories
  as restrictive
  for update
  to authenticated
  using (
    not (select public.is_library_admin())
    or (select public.admin_totp_aal2())
  )
  with check (
    not (select public.is_library_admin())
    or (select public.admin_totp_aal2())
  );
create policy "Require TOTP AAL2 for admin category deletes"
  on public.categories
  as restrictive
  for delete
  to authenticated
  using (
    not (select public.is_library_admin())
    or (select public.admin_totp_aal2())
  );

create or replace function public.library_dashboard_stats()
returns table(total_videos bigint, published_videos bigint, total_categories bigint, total_views bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_library_admin() then raise exception 'Not authorized'; end if;
  if not public.admin_totp_aal2() then raise exception 'MFA verification required' using errcode = '42501'; end if;
  return query select
    (select count(*) from public.videos),
    (select count(*) from public.videos where published),
    (select count(*) from public.categories),
    (select coalesce(sum(v.views), 0)::bigint from public.videos as v);
end;
$$;

revoke all on function public.library_dashboard_stats() from public, anon;
grant execute on function public.library_dashboard_stats() to authenticated;
