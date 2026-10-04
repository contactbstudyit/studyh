revoke all privileges on table public.videos, public.categories from anon, authenticated;

grant select on table public.videos, public.categories to anon, authenticated;
grant insert, update, delete on table public.videos, public.categories to authenticated;
