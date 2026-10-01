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
    let stage: "auth" | "membership" = "auth";
    try {
      const client = createClient();
      const email = String(form.get("email"));
      const { error: loginError } = await client.auth.signInWithPassword({ email, password: String(form.get("password")) });
      if (loginError) throw loginError;
      stage = "membership";
      const { data: userData } = await client.auth.getUser();
      const { data: membership, error: memberError } = await client.from("admins").select("user_id").eq("user_id", userData.user?.id ?? "").maybeSingle();
      if (memberError) throw memberError;
      if (!membership) { await client.auth.signOut(); throw new Error("This account is not authorized for the admin area."); }
      router.replace("/admin"); router.refresh();
    } catch (cause) {
      const message = cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" ? cause.message : "";
      const normalized = message.toLowerCase();
      if (message === "This account is not authorized for the admin area.") setError(message);
      else if (stage === "auth" && (normalized.includes("invalid login") || normalized.includes("invalid_credentials"))) setError("Email or password is incorrect, or this email has not been created as a Supabase Auth user yet.");
      else if (stage === "auth") setError("Could not reach Supabase Auth. Check the Supabase URL/key and confirm this account exists.");
      else setError("Signed in, but admin access could not be checked. Apply the database migrations and add this Auth user to public.admins.");
    }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><ShieldCheck size={22}/><span className="eyebrow">RESTRICTED ACCESS</span><h1>Admin sign in</h1><p>Sign in with your authorized admin account.</p><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button><a href="/">Return to videos</a></form></main>;
}
