create table if not exists public.reel_impressions (
  visitor_id uuid not null,
  video_id uuid not null references public.videos(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  first_shown_at timestamptz not null default now(),
  last_shown_at timestamptz not null default now(),
  watched_at timestamptz,
  impression_count integer not null default 1 check (impression_count > 0),
  primary key (visitor_id, video_id)
);

create index if not exists reel_impressions_visitor_category_idx
  on public.reel_impressions(visitor_id, category_id, last_shown_at desc);
create index if not exists reel_impressions_visitor_unwatched_idx
  on public.reel_impressions(visitor_id, category_id, watched_at, last_shown_at);

alter table public.reel_impressions enable row level security;
revoke all on public.reel_impressions from anon, authenticated;

create or replace function public.record_reel_impression(
  p_visitor_id uuid,
  p_video_id uuid,
  p_watched boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  video_category uuid;
begin
  if p_visitor_id is null or p_video_id is null then return false; end if;
  select category_id into video_category from public.videos where id = p_video_id and published = true;
  if video_category is null then return false; end if;
  insert into public.reel_impressions(visitor_id, video_id, category_id, watched_at)
  values (p_visitor_id, p_video_id, video_category, case when p_watched then now() else null end)
  on conflict (visitor_id, video_id) do update set
    category_id = excluded.category_id,
    last_shown_at = now(),
    impression_count = public.reel_impressions.impression_count + case when p_watched then 0 else 1 end,
    watched_at = coalesce(public.reel_impressions.watched_at, excluded.watched_at);
  return true;
end;
$$;

revoke all on function public.record_reel_impression(uuid, uuid, boolean) from public;
grant execute on function public.record_reel_impression(uuid, uuid, boolean) to anon, authenticated;

create or replace function public.fresh_category_reels(
  p_visitor_id uuid,
  p_category_id uuid,
  p_page integer default 1,
  p_page_size integer default 4,
  p_exclude_ids uuid[] default '{}'
)
returns table(
  id uuid,
  title text,
  description text,
  thumbnail_url text,
  category_id uuid,
  tags text[],
  duration text,
  views bigint,
  display_view_count bigint,
  published_at timestamptz,
  featured boolean,
  published boolean,
  created_at timestamptz,
  updated_at timestamptz,
  video_url text
)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select v.*, i.last_shown_at, i.watched_at,
      case when i.video_id is null then 0 when i.watched_at is null then 1 else 2 end as recommendation_tier
    from public.videos v
    left join public.reel_impressions i on i.video_id = v.id and i.visitor_id = p_visitor_id
    where v.category_id = p_category_id
      and v.published = true
      and not (v.id = any(coalesce(p_exclude_ids, '{}'::uuid[])))
  )
  select c.id, c.title, c.description, c.thumbnail_url, c.category_id, c.tags, c.duration,
    c.views, c.display_view_count, c.published_at, c.featured, c.published,
    c.created_at, c.updated_at, c.video_url
  from candidates c
  order by c.recommendation_tier,
    case when c.recommendation_tier < 2 then md5(p_visitor_id::text || ':' || c.id::text) else '' end,
    case when c.recommendation_tier = 2 then c.last_shown_at else null end nulls first,
    c.created_at desc, c.id
  offset greatest(0, (p_page - 1) * least(greatest(p_page_size, 1), 20))
  limit least(greatest(p_page_size, 1), 20);
$$;

revoke all on function public.fresh_category_reels(uuid, uuid, integer, integer, uuid[]) from public;
grant execute on function public.fresh_category_reels(uuid, uuid, integer, integer, uuid[]) to anon, authenticated;
