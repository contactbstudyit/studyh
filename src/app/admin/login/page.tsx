"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
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
  async function requestPasswordReset() {
    setError("");
    const normalizedEmail = email.trim();
    if (!normalizedEmail) { setError("Enter your admin email above, then choose Forgot password."); return; }
    setBusy(true);
    try {
      const client = createClient();
      const { error: resetError } = await client.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: new URL("/admin/reset-password", window.location.origin).toString(),
      });
      if (resetError) throw resetError;
      setError("If this email belongs to an admin account, a password reset link has been sent. Check your inbox and spam folder.");
    } catch {
      setError("Could not send the reset email. Check the Supabase recovery URL configuration and try again.");
    } finally {
      setBusy(false);
    }
  }
  return <main className="auth-page"><div className="auth-card"><form onSubmit={submit}><ShieldCheck size={22}/><span className="eyebrow">RESTRICTED ACCESS</span><h1>Admin sign in</h1><p>Sign in with your authorized admin account.</p><label>Email<input name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error && <div className="auth-error" role="status">{error}</div>}<button className="button-primary" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button><button className="admin-reset-link" type="button" onClick={() => void requestPasswordReset()} disabled={busy}>Forgot password?</button></form><Link href="/">Return to videos</Link></div></main>;
}
