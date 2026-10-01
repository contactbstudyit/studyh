"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck } from "lucide-react";

export default function AdminLogin() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  async function bootstrap(setupToken: string) {
    const response = await fetch("/api/admin/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setupToken }) });
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      throw new Error(body.error || "First-admin setup failed.");
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const client = createClient();
      const email = String(form.get("email"));
      const setupToken = String(form.get("setup_token") ?? "");
      if (form.get("mode") === "signup") {
        const password = String(form.get("password"));
        if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
        if (password !== String(form.get("confirm_password"))) throw new Error("The passwords do not match.");
        if (setupToken.length < 24) throw new Error("Enter the one-time setup token configured by the site administrator.");
        const { data, error: signupError } = await client.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/admin/login` } });
        if (signupError) throw signupError;
        if (data.session) {
          await bootstrap(setupToken);
          router.replace("/admin"); router.refresh(); return;
        }
        setNotice("Account created. Sign in to continue first-admin setup.");
        return;
      }
      const { error: loginError } = await client.auth.signInWithPassword({ email, password: String(form.get("password")) });
      if (loginError) throw loginError;
      const { data: userData } = await client.auth.getUser();
      const { data: membership, error: memberError } = await client.from("admins").select("user_id").eq("user_id", userData.user?.id ?? "").maybeSingle();
      if (memberError) throw memberError;
      if (!membership) {
        if (!setupToken) throw new Error("This account is not an admin. First-admin setup requires the one-time setup token.");
        try { await bootstrap(setupToken); }
        catch (cause) { await client.auth.signOut(); throw cause; }
      }
      router.replace("/admin"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign in. Check your credentials and try again."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><ShieldCheck size={22}/><span className="eyebrow">RESTRICTED ACCESS</span><h1>{signup ? "First admin signup" : "Admin sign in"}</h1><p>{signup ? "Use the designated admin email and one-time setup token." : "Sign in with your authorized admin account."}</p><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 12 : undefined} required/></label>{signup && <label>Confirm password<input name="confirm_password" type="password" autoComplete="new-password" minLength={12} required/></label>}<label>One-time setup token <small>Required only for the first admin account.</small><input name="setup_token" type="password" autoComplete="off" minLength={signup ? 24 : undefined} required={signup}/></label><input type="hidden" name="mode" value={signup ? "signup" : "signin"}/>{error && <div className="auth-error" role="alert">{error}</div>}{notice && <div className="auth-notice" role="status">{notice}</div>}<button className="button-primary" type="submit" disabled={busy}>{busy ? "Please wait..." : signup ? "Create first admin account" : "Sign in"}</button><button className="auth-mode" type="button" onClick={() => { setSignup(!signup); setError(""); setNotice(""); }}>{signup ? "Already have an account? Sign in" : "First time? Sign up"}</button><a href="/">Return to videos</a></form></main>;
}
