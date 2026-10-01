alter table public.videos
  add column if not exists display_view_count bigint;

alter table public.videos
  add column if not exists published_at timestamptz;

update public.videos
set display_view_count = 5000 + floor(random() * 25001)::bigint
where display_view_count is null;

update public.videos
set published_at = created_at
where published = true and published_at is null;

alter table public.videos
  alter column display_view_count set default (5000 + floor(random() * 25001)::bigint);

alter table public.videos
  alter column display_view_count set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.videos'::regclass
      and conname = 'videos_display_view_count_range_check'
  ) then
    alter table public.videos
      add constraint videos_display_view_count_range_check
      check (display_view_count between 5000 and 30000);
  end if;
end;
$$;

create or replace function public.set_video_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.published = true and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists videos_set_published_at on public.videos;
create trigger videos_set_published_at
before insert or update of published on public.videos
for each row execute function public.set_video_published_at();

comment on column public.videos.views is 'Real, atomically recorded play views; never contains promotional display views.';
comment on column public.videos.display_view_count is 'Persistent promotional base used only in public displayed view totals.';
comment on column public.videos.published_at is 'First publication timestamp used for deterministic promotional display growth.';
