# Supabase setup

1. Apply pending migrations in order in the Supabase SQL Editor. The current sequence is `202610010001_video_library.sql` through `202610010011_cloudflare_video_account_slots.sql`; do not re-run migrations already applied.
2. In Supabase Authentication, create the user `contact.eonemusic@gmail.com` with the password you intend to use. Email confirmation can remain disabled.
3. Grant admin membership to that Auth user in the SQL Editor:

```sql
insert into public.admins (user_id)
select id from auth.users where lower(email) = lower('contact.eonemusic@gmail.com')
on conflict (user_id) do nothing;
```

4. Open `/admin/login` and sign in with that email and password. There is no setup-token field in the login flow.

The public key is intentionally used by the app; row-level security protects the data. Never put a Supabase service-role key in a `NEXT_PUBLIC_` variable.

The media relay requires a dedicated server-only `MEDIA_PROXY_SECRET` (at least 32 random bytes). Configure a different strong value in each deployment environment; it must not use `SUPABASE_ACCESS_TOKEN`, an R2 credential, or any `NEXT_PUBLIC_` variable. The local ignored `.env` contains a generated value.

## Admin TOTP MFA

Admin sign-in requires the existing email/password followed by a verified Supabase Auth TOTP factor. On first sign-in, the admin is sent to the authenticator setup screen; access stays blocked until the code verifies and Supabase reports an AAL2 session. Apply migration `202610010007_require_admin_totp_aal2.sql` to enforce AAL2 with a verified TOTP factor in the admin video/category RLS policies and dashboard statistics RPC. Public reads remain available.

In Supabase Auth settings, keep TOTP enrollment, challenge, and verification enabled. Supabase Auth owns the TOTP secret, challenge, verification, and rate limiting; no application OTP table or email/Resend configuration is used for this flow.

The required environment values are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a Supabase publishable key is also accepted as the key value). Public videos and categories are readable through RLS; all mutations require an authenticated user whose ID exists in `public.admins`.

## Cloudflare video account slots

Cloudflare account credentials are configured only as server-side deployment secrets, not entered or stored in the admin UI or Supabase. Configure numbered slots using `CLOUDFLARE_VIDEO_R2_ACCOUNT_ID_1`, `CLOUDFLARE_VIDEO_R2_ACCESS_KEY_ID_1`, `CLOUDFLARE_VIDEO_R2_SECRET_ACCESS_KEY_1`, `CLOUDFLARE_VIDEO_R2_BUCKET_NAME_1`, and `CLOUDFLARE_VIDEO_R2_PUBLIC_URL_1`; repeat with `_2`, `_3`, etc. The selector also accepts the equivalent numbered prefix format, such as `2_CLOUDFLARE_VIDEO_R2_ACCOUNT_ID`, for credentials already configured that way. Optionally set `CLOUDFLARE_VIDEO_R2_ACCOUNT_NAME_1` for a friendly selector label and `CLOUDFLARE_VIDEO_R2_DEFAULT_ACCOUNT` to the default slot number. Account IDs, keys, buckets, and public URLs remain backend-only; the admin receives only slot labels and bucket names. No encryption-key secret is needed because account credentials remain deployment secrets.

Apply migration `202610010011_cloudflare_video_account_slots.sql` so each uploaded video record stores its account slot and bucket name. R2 public CORS must allow `PUT` and the `Content-Type` header from the production origin and the active preview origin. Presigned uploads go directly from the browser to the selected R2 endpoint; the existing `CLOUDFLARE_R2_*` thumbnail credentials and thumbnail storage are separate and unchanged.
