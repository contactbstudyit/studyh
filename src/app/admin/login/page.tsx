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
    let stage: "client" | "sign-in" | "get-user" | "membership" = "client";
    const projectHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host; } catch { return "invalid Supabase URL"; } })();
    try {
      const client = createClient();
      const email = String(form.get("email"));
      stage = "sign-in";
      const { error: loginError } = await client.auth.signInWithPassword({ email, password: String(form.get("password")) });
      if (loginError) throw loginError;
      stage = "get-user";
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      const user = userData.user;
      if (!user?.id) throw new Error("Supabase Auth returned no authenticated user after sign-in.");
      stage = "membership";
      const { data: membership, error: memberError } = await client.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      if (memberError) {
        const diagnostic = { projectHost, userId: user.id, table: "public.admins", query: "select user_id where user_id = authenticated user UUID", message: memberError.message, code: memberError.code, details: memberError.details, hint: memberError.hint };
        if (process.env.NODE_ENV === "development") console.error("[admin-auth] membership query failed", diagnostic);
        const info = process.env.NODE_ENV === "development" ? ` ${JSON.stringify({ message: memberError.message, code: memberError.code, details: memberError.details, hint: memberError.hint, userId: user.id, projectHost })}` : ` (${memberError.code || "membership_error"}: ${memberError.message})`;
        await client.auth.signOut();
        setError(`Could not verify admin membership.${info}`);
        return;
      }
      if (!membership) {
        const diagnostic = { projectHost, userId: user.id, query: "public.admins.select(user_id).eq(user_id, user.id).maybeSingle()", result: null, error: null };
        if (process.env.NODE_ENV === "development") console.warn("[admin-auth] no admins membership row", diagnostic);
        await client.auth.signOut();
        setError(process.env.NODE_ENV === "development" ? `No admin membership row returned. ${JSON.stringify(diagnostic)}` : "This authenticated account is not authorized for the admin area.");
        return;
      }
      router.replace("/admin"); router.refresh();
    } catch (cause) {
      const supabaseError = cause && typeof cause === "object" ? cause as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown } : null;
      const message = typeof supabaseError?.message === "string" ? supabaseError.message : String(cause);
      const normalized = message.toLowerCase();
      const diagnostic = { stage, projectHost, message, code: supabaseError?.code, details: supabaseError?.details, hint: supabaseError?.hint };
      if (process.env.NODE_ENV === "development") console.error("[admin-auth] sign-in flow failed", diagnostic);
      if (stage === "sign-in" && (normalized.includes("invalid login") || normalized.includes("invalid_credentials"))) setError("Email or password is incorrect.");
      else if (stage === "sign-in") setError(`Supabase Auth sign-in failed: ${message}`);
      else if (stage === "get-user") setError(`Sign-in succeeded, but Supabase could not verify the user: ${message}`);
      else if (stage === "membership") setError(`Admin membership check failed: ${message}${process.env.NODE_ENV === "development" ? ` ${JSON.stringify(diagnostic)}` : ""}`);
      else setError(`Supabase client setup failed: ${message}`);
    }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><ShieldCheck size={22}/><span className="eyebrow">RESTRICTED ACCESS</span><h1>Admin sign in</h1><p>Sign in with your authorized admin account.</p><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button><a href="/">Return to videos</a></form></main>;
}
