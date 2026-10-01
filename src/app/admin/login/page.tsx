"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck } from "lucide-react";

export default function AdminLogin() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const { error: loginError } = await createClient().auth.signInWithPassword({ email: String(form.get("email")), password: String(form.get("password")) });
      if (loginError) throw loginError;
      const { data: userData } = await createClient().auth.getUser();
      const { data: membership, error: memberError } = await createClient().from("admins").select("user_id").eq("user_id", userData.user?.id ?? "").maybeSingle();
      if (memberError || !membership) { await createClient().auth.signOut(); throw new Error("This account is not authorized for the admin area."); }
      router.replace("/admin"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign in. Check your credentials and try again."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><ShieldCheck size={22}/><span className="eyebrow">RESTRICTED ACCESS</span><h1>Admin sign in</h1><p>Sign in with your authorized admin account.</p><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button><a href="/">Return to videos</a></form></main>;
}
