# Supabase setup

1. Apply `migrations/202610010001_video_library.sql` in the Supabase SQL Editor.
2. In the SQL Editor, configure the one-time email allowed to claim the initial admin account:

```sql
insert into public.admin_bootstrap_settings (singleton, email)
values (true, 'admin@example.com');
```

3. Ensure email confirmation is enabled in Supabase Auth. Open `/admin/login`, choose **First time? Sign up**, and register that exact email. Confirm the email, then sign in. The database grants admin access only to that verified address, only while no admin exists, and consumes the one-time bootstrap setting when it succeeds. All other signups remain ordinary users with no admin access.
4. After the first admin is created, disable public sign-ups in Supabase Auth if you do not need other user accounts.

The public key is intentionally used by the app; row-level security protects the data. Never put a Supabase service-role key in a `NEXT_PUBLIC_` variable.

The required environment values are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a Supabase publishable key is also accepted as the key value). Public videos and categories are readable through RLS; all mutations require an authenticated user whose ID exists in `public.admins`.
