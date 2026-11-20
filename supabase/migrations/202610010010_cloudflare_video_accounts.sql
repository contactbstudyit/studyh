create table if not exists public.cloudflare_video_accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 100),
  account_id text not null check (account_id ~ '^[a-f0-9]{32}$'),
  access_key_id_ciphertext text not null,
  secret_access_key_ciphertext text not null,
  endpoint text not null check (endpoint ~ '^https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com$'),
  bucket_name text not null check (char_length(bucket_name) between 3 and 63),
  public_url text not null check (public_url ~ '^https://'),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cloudflare_video_accounts_one_default_idx
  on public.cloudflare_video_accounts (is_default)
  where is_default;

alter table public.cloudflare_video_accounts enable row level security;
revoke all on public.cloudflare_video_accounts from anon, authenticated;
grant select, insert, update, delete on public.cloudflare_video_accounts to authenticated;

drop policy if exists "Admin AAL2 manages video storage accounts" on public.cloudflare_video_accounts;
create policy "Admin AAL2 manages video storage accounts"
  on public.cloudflare_video_accounts
  for all
  to authenticated
  using ((select public.is_library_admin()) and (select public.admin_totp_aal2()))
  with check ((select public.is_library_admin()) and (select public.admin_totp_aal2()));

alter table public.videos
  add column if not exists cloudflare_video_account_id uuid references public.cloudflare_video_accounts(id) on delete restrict,
  add column if not exists cloudflare_video_bucket_name text;

create index if not exists videos_cloudflare_video_account_idx
  on public.videos (cloudflare_video_account_id)
  where cloudflare_video_account_id is not null;
