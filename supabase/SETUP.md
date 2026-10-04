# Supabase setup

1. Apply pending migrations in order in the Supabase SQL Editor. The current sequence is `202610010001_video_library.sql` through `202610010009_revoke_public_stats_rpc.sql`; do not re-run migrations already applied.
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
