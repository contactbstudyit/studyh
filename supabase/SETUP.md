# Supabase setup

1. Apply migrations in order in the Supabase SQL Editor: `202610010001_video_library.sql`, then `202610010002_unverified_admin_bootstrap.sql`. If migration 001 is already applied, apply only 002.
2. Generate a high-entropy one-time token (for example, `openssl rand -base64 36`). Set it as the server-only `ADMIN_SETUP_TOKEN` environment secret (never `NEXT_PUBLIC_`). Use the same token in the SQL below. Configure the one-time designated admin email as requested:

```sql
insert into public.admin_bootstrap_settings (singleton, email, token_hash)
values (true, 'contact.eonemusic@gmail.com', digest('PASTE_THE_SAME_SETUP_TOKEN_HERE', 'sha256'))
on conflict (singleton) do update
set email = excluded.email, token_hash = excluded.token_hash;
```

3. Open `/admin/login`, choose **First time? Sign up**, and register that exact email with the setup token. Email confirmation can be disabled because the independent high-entropy token gates first-admin creation. After signup, the setup token is checked server-side and against its database hash; the database consumes the one-time setting when it succeeds. All other accounts remain ordinary users with no admin access.
4. After the first admin is created, disable public sign-ups in Supabase Auth if you do not need other user accounts. The setup token can no longer grant access after the one-time database setting is consumed.

The public key is intentionally used by the app; row-level security protects the data. Never put a Supabase service-role key in a `NEXT_PUBLIC_` variable.

The required environment values are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a Supabase publishable key is also accepted as the key value). Public videos and categories are readable through RLS; all mutations require an authenticated user whose ID exists in `public.admins`.
