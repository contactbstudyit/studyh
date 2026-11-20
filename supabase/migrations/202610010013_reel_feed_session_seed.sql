drop function if exists public.fresh_category_reels(uuid, uuid, integer, integer, uuid[]);

create or replace function public.fresh_category_reels(
  p_visitor_id uuid,
  p_category_id uuid,
  p_feed_session_id uuid,
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
    case when c.recommendation_tier < 2 then md5(p_visitor_id::text || ':' || p_feed_session_id::text || ':' || c.id::text) else '' end,
    case when c.recommendation_tier = 2 then c.last_shown_at else null end nulls first,
    c.created_at desc, c.id
  offset greatest(0, (p_page - 1) * least(greatest(p_page_size, 1), 20))
  limit least(greatest(p_page_size, 1), 20);
$$;

revoke all on function public.fresh_category_reels(uuid, uuid, uuid, integer, integer, uuid[]) from public;
grant execute on function public.fresh_category_reels(uuid, uuid, uuid, integer, integer, uuid[]) to anon, authenticated;
