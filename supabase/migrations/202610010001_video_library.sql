create extension if not exists pgcrypto;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  description text not null default '',
  image_url text check (image_url is null or image_url ~ '^https://[^[:space:]/]+([/?#]|$)'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  video_url text not null check (video_url ~ '^https://[^[:space:]/]+([/?#]|$)'),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 10000),
  thumbnail_url text check (thumbnail_url is null or thumbnail_url ~ '^https://[^[:space:]/]+([/?#]|$)'),
  category_id uuid not null references public.categories(id) on delete restrict,
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  search_vector tsvector generated always as (to_tsvector('english', title || ' ' || description || ' ' || array_to_string(tags, ' '))) stored,
  duration text not null default '',
  views bigint not null default 0 check (views >= 0),
  featured boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  singleton boolean not null default true check (singleton),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_bootstrap_settings (
  singleton boolean primary key default true check (singleton),
  email text not null
);

create table if not exists public.video_view_events (
  video_id uuid not null references public.videos(id) on delete cascade,
  viewer_key uuid not null,
  viewed_at timestamptz not null default now(),
  primary key (video_id, viewer_key)
);

create index if not exists videos_category_created_idx on public.videos(category_id, created_at desc);
create index if not exists videos_published_created_idx on public.videos(created_at desc) where published = true;
create index if not exists videos_search_idx on public.videos using gin (search_vector);
create index if not exists videos_tags_idx on public.videos using gin (tags);

create or replace function public.is_library_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = (select auth.uid())) $$;

revoke all on function public.is_library_admin() from public;
grant execute on function public.is_library_admin() to authenticated;
grant execute on function public.is_library_admin() to anon;

alter table public.categories enable row level security;
alter table public.videos enable row level security;
alter table public.admins enable row level security;
alter table public.admin_bootstrap_settings enable row level security;
alter table public.video_view_events enable row level security;

drop policy if exists "Public can read categories" on public.categories;
create policy "Public can read categories" on public.categories for select using (true);
drop policy if exists "Admins manage categories" on public.categories;
create policy "Admins manage categories" on public.categories for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

drop policy if exists "Public can read published videos" on public.videos;
create policy "Public can read published videos" on public.videos for select using (published = true or public.is_library_admin());
drop policy if exists "Admins manage videos" on public.videos;
create policy "Admins manage videos" on public.videos for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

drop policy if exists "Admins can read own membership" on public.admins;
create policy "Admins can read own membership" on public.admins for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.admins, public.admin_bootstrap_settings, public.video_view_events from anon, authenticated;
grant select on public.admins to authenticated;

create or replace function public.bootstrap_first_admin()
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  allowed_email text;
begin
  if auth.uid() is null then return false; end if;
  select email into allowed_email from public.admin_bootstrap_settings where singleton = true for update;
  if allowed_email is null or lower(allowed_email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then return false; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null and lower(email) = lower(allowed_email)) then return false; end if;
  if exists (select 1 from public.admins) then return false; end if;
  insert into public.admins (user_id) values (auth.uid()) on conflict do nothing;
  if not found then return false; end if;
  delete from public.admin_bootstrap_settings where singleton = true;
  return true;
end;
$$;
revoke all on function public.bootstrap_first_admin() from public;
grant execute on function public.bootstrap_first_admin() to authenticated;

create or replace function public.record_video_view(p_video_id uuid, p_viewer_key uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.video_view_events (video_id, viewer_key)
  select id, p_viewer_key from public.videos where id = p_video_id and published = true
  on conflict (video_id, viewer_key) do update set viewed_at = now()
    where public.video_view_events.viewed_at < now() - interval '24 hours';
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return false; end if;
  update public.videos set views = views + 1 where id = p_video_id and published = true;
  return found;
end;
$$;

revoke all on function public.record_video_view(uuid, uuid) from public;
grant execute on function public.record_video_view(uuid, uuid) to anon, authenticated;

create or replace function public.library_dashboard_stats()
returns table(total_videos bigint, published_videos bigint, total_categories bigint, total_views bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_library_admin() then raise exception 'Not authorized'; end if;
  return query select
    (select count(*) from public.videos),
    (select count(*) from public.videos where published),
    (select count(*) from public.categories),
    (select coalesce(sum(views), 0) from public.videos);
end;
$$;
revoke all on function public.library_dashboard_stats() from public;
grant execute on function public.library_dashboard_stats() to authenticated;

grant select on public.categories, public.videos to anon, authenticated;
grant insert, update, delete on public.categories, public.videos to authenticated;
revoke all on public.video_view_events from anon, authenticated;

comment on table public.admins is 'Add an admin by inserting the matching auth.users.id from the Supabase SQL editor.';
