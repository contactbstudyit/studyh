alter table public.videos
  add column if not exists cloudflare_video_account_slot text,
  add column if not exists cloudflare_video_bucket_name text;

create index if not exists videos_cloudflare_video_account_slot_idx
  on public.videos (cloudflare_video_account_slot)
  where cloudflare_video_account_slot is not null;
