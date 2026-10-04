"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

type TotpFactor = { id: string; friendlyName: string };
type Enrollment = { factorId: string; qrCode: string; secret: string };

export default function AdminTotpMfa({ mode, factors }: { mode: "challenge" | "enroll"; factors: TotpFactor[] }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startingEnrollment, setStartingEnrollment] = useState(false);
  const [selectedFactorId, setSelectedFactorId] = useState(factors[0]?.id ?? "");

  async function startEnrollment() {
    setStartingEnrollment(true);
    setError("");
    try {
      const { data, error: enrollError } = await createClient().auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Admin authenticator",
        issuer: "Admin",
      });
      if (enrollError || !data || data.type !== "totp") throw enrollError ?? new Error("TOTP enrollment returned no factor.");
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setSelectedFactorId(data.id);
    } catch {
      setError("Could not start authenticator setup. Please try again.");
    } finally {
      setStartingEnrollment(false);
    }
  }

  async function cancel() {
    await createClient().auth.signOut({ scope: "local" });
    router.replace("/admin/login");
    router.refresh();
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const factorId = enrollment?.factorId ?? selectedFactorId;
      if (!factorId) throw new Error("No TOTP factor is available.");

      const client = createClient();
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId });
      if (challengeError || !challenge) throw challengeError ?? new Error("No TOTP challenge was returned.");

      const { error: verifyError } = await client.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) throw verifyError;

      const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError || assurance?.currentLevel !== "aal2" || assurance.nextLevel !== "aal2") {
        throw assuranceError ?? new Error("TOTP verification did not produce an AAL2 session.");
      }

      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw userError ?? new Error("No authenticated user was returned.");
      const { data: membership, error: membershipError } = await client
        .from("admins")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (membershipError || !membership) {
        await client.auth.signOut({ scope: "local" });
        setError("Admin access could not be verified. Sign in again.");
        return;
      }

      toast.success(enrollment ? "Authenticator app enabled." : "Identity verified.");
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Verification code is incorrect or expired. Check your authenticator and try again.");
    } finally {
      setBusy(false);
    }
  }

  const isEnrollment = mode === "enroll";

  return <main className="auth-page"><section className="auth-card admin-mfa-card">
    <span className="eyebrow">RESTRICTED ACCESS</span>
    <h1>{isEnrollment ? "Secure your admin account" : "Verify your identity"}</h1>
    {isEnrollment
      ? <p>Set up an authenticator app. A current 6-digit code is required for every admin session.</p>
      : <p>Enter the 6-digit code from your authenticator app to continue.</p>}

    {isEnrollment && !enrollment && <button className="button-primary" type="button" onClick={() => void startEnrollment()} disabled={startingEnrollment}>
      {startingEnrollment ? "Preparing setup..." : "Set up authenticator"}
    </button>}

    {enrollment && <div className="totp-enrollment" aria-live="polite">
      <img src={enrollment.qrCode} alt="Scan this QR code with your authenticator app"/>
      <p>Scan this code with your authenticator app. If scanning is unavailable, enter this setup key manually:</p>
      <code>{enrollment.secret}</code>
    </div>}

    {(!isEnrollment || enrollment) && <form onSubmit={verifyCode}>
      <label htmlFor="admin-totp-code">6-digit authenticator code</label>
      <input
        id="admin-totp-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        required
        aria-describedby={error ? "admin-totp-error" : undefined}
      />
      {error && <div className="auth-error" id="admin-totp-error" role="alert">{error}</div>}
      <button className="button-primary" type="submit" disabled={busy || code.length !== 6}>
        {busy ? "Verifying..." : isEnrollment ? "Verify and enable" : "Verify code"}
      </button>
    </form>}

    {isEnrollment && error && !enrollment && <div className="auth-error" role="alert">{error}</div>}
    <button className="admin-mfa-cancel" type="button" onClick={() => void cancel()} disabled={busy || startingEnrollment}>Back to login</button>
  </section></main>;
}
