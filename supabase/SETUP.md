# Supabase setup

1. Apply migrations in order in the Supabase SQL Editor: `202610010001_video_library.sql`, `202610010002_unverified_admin_bootstrap.sql`, and `202610010003_remove_bootstrap_token.sql`. If 001 and 002 were already applied, apply only 003.
2. In Supabase Authentication, create the user `contact.eonemusic@gmail.com` with the password you intend to use. Email confirmation can remain disabled.
3. Grant admin membership to that Auth user in the SQL Editor:

```sql
insert into public.admins (user_id)
select id from auth.users where lower(email) = lower('contact.eonemusic@gmail.com')
on conflict (user_id) do nothing;
```

4. Open `/admin/login` and sign in with that email and password. There is no setup-token field in the login flow.

The public key is intentionally used by the app; row-level security protects the data. Never put a Supabase service-role key in a `NEXT_PUBLIC_` variable.

The required environment values are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a Supabase publishable key is also accepted as the key value). Public videos and categories are readable through RLS; all mutations require an authenticated user whose ID exists in `public.admins`.
