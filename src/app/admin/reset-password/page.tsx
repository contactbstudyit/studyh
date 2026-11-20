"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AdminResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    let active = true;
    const client = createClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        setReady(true);
        setError("");
      }
    });

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const query = new URLSearchParams(window.location.search);
      const hasRecoveryToken = hash.get("type") === "recovery" && Boolean(hash.get("access_token")) && Boolean(hash.get("refresh_token"));
      const code = query.get("code");
      if (hasRecoveryToken && !data.session) {
        void client.auth.setSession({ access_token: hash.get("access_token")!, refresh_token: hash.get("refresh_token")! }).then(({ data: authData, error: authError }) => {
          if (!active) return;
          if (authError || !authData.session) setError("This password reset link is invalid or expired. Request a new one and open it promptly.");
          else setReady(true);
        });
        return;
      }
      if (code) {
        void client.auth.exchangeCodeForSession(code).then(({ data: authData, error: authError }) => {
          if (!active) return;
          if (authError || !authData.session) setError("This password reset link is invalid or expired. Request a new one and open it promptly.");
          else setReady(true);
        });
        return;
      }
      if (!sessionError && data.session && data.session.user.aud === "authenticated") setReady(true);
      else setError("This password reset link is invalid or expired. Request a new one and open it promptly.");
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 8) { setError("Choose a password with at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const client = createClient();
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw updateError;
      await client.auth.signOut({ scope: "local" });
      setComplete(true);
    } catch {
      setError("Could not update the password. The reset link may have expired; request another and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page"><section className="auth-card">
    <KeyRound size={22}/>
    <span className="eyebrow">ADMIN ACCOUNT RECOVERY</span>
    <h1>{complete ? "Password updated" : "Reset admin password"}</h1>
    {complete
      ? <><p>Your password has been updated. Sign in with the new password and complete authenticator verification.</p><Link className="button-primary admin-reset-continue" href="/admin/login">Return to admin sign in</Link></>
      : ready
        ? <form onSubmit={updatePassword}>
            <p>Choose a new password for your admin account.</p>
            <label>New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)}/></label>
            <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}/></label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="button-primary" type="submit" disabled={busy}>{busy ? "Updating password..." : "Update password"}</button>
          </form>
        : <><p>{error || "Verifying your secure reset link..."}</p><Link href="/admin/login">Return to admin sign in</Link></>}
  </section></main>;
}
