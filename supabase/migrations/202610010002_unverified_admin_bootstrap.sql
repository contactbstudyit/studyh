create table if not exists public.admin_bootstrap_settings (
  singleton boolean primary key default true check (singleton),
  email text not null,
  token_hash bytea
);

alter table public.admin_bootstrap_settings add column if not exists token_hash bytea;
alter table public.admin_bootstrap_settings enable row level security;
revoke all on public.admin_bootstrap_settings from public, anon, authenticated;
alter table public.admin_bootstrap_settings drop constraint if exists admin_bootstrap_settings_token_hash_check;
alter table public.admin_bootstrap_settings add constraint admin_bootstrap_settings_token_hash_check check (token_hash is null or octet_length(token_hash) = 32);

drop function if exists public.bootstrap_first_admin();

create or replace function public.bootstrap_first_admin(p_setup_token text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  allowed_email text;
  allowed_token_hash bytea;
begin
  if auth.uid() is null then return false; end if;
  select email, token_hash into allowed_email, allowed_token_hash
  from public.admin_bootstrap_settings where singleton = true for update;
  if allowed_email is null or lower(allowed_email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then return false; end if;
  if allowed_token_hash is null or p_setup_token is null or digest(p_setup_token, 'sha256') <> allowed_token_hash then return false; end if;
  if exists (select 1 from public.admins) then return false; end if;
  insert into public.admins (user_id) values (auth.uid()) on conflict do nothing;
  if not found then return false; end if;
  delete from public.admin_bootstrap_settings where singleton = true;
  return true;
end;
$$;

revoke all on function public.bootstrap_first_admin(text) from public;
grant execute on function public.bootstrap_first_admin(text) to authenticated;
