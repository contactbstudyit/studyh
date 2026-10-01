alter table public.admins add column if not exists singleton boolean not null default true;
alter table public.admins drop constraint if exists admins_singleton_check;
alter table public.admins add constraint admins_singleton_check check (singleton);
create unique index if not exists admins_single_admin_idx on public.admins(singleton);
