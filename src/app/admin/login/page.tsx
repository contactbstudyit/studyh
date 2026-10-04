"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck } from "lucide-react";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";

export default function AdminLogin() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const safeSignInError = "Unable to sign in. Check your credentials and try again.";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const client = createClient();
      const email = String(form.get("email"));
      const { error: loginError } = await client.auth.signInWithPassword({ email, password: String(form.get("password")) });
      if (loginError) {
        setError(safeSignInError);
        return;
      }

      const { data: userData, error: userError } = await client.auth.getUser();
      const user = userData.user;
      if (userError || !user?.id) {
        await client.auth.signOut({ scope: "local" });
        setError(safeSignInError);
        return;
      }

      const { data: membership, error: memberError } = await client.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      if (memberError || !membership) {
        await client.auth.signOut({ scope: "local" });
        setError(safeSignInError);
        return;
      }

      const mfaStatus = await getAdminMfaStatus(client);
      if (mfaStatus.error) {
        await client.auth.signOut({ scope: "local" });
        setError(safeSignInError);
        return;
      }

      router.replace(hasAdminTotpAal2(mfaStatus) ? "/admin" : "/admin/login/mfa");
      router.refresh();
    } catch {
      setError(safeSignInError);
    }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><ShieldCheck size={22}/><span className="eyebrow">RESTRICTED ACCESS</span><h1>Admin sign in</h1><p>Sign in with your authorized admin account.</p><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button><a href="/">Return to videos</a></form></main>;
}
