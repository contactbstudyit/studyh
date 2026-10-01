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
    (select coalesce(sum(v.views), 0)::bigint from public.videos as v);
end;
$$;
