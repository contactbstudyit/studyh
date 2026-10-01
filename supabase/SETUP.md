# Supabase setup

1. Apply `migrations/202610010001_video_library.sql` in the Supabase SQL Editor.
2. In Supabase Authentication, create the initial admin user and disable public sign-ups.
3. In the SQL Editor, add only that account to the admin allowlist:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'admin@example.com';
```

Use the actual admin email in place of the example. The public key is intentionally used by the app; row-level security protects the data. Never put a Supabase service-role key in a `NEXT_PUBLIC_` variable.

The required environment values are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a Supabase publishable key is also accepted as the key value). Public videos and categories are readable through RLS; all mutations require an authenticated user whose ID exists in `public.admins`.
