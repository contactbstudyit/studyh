import type { SupabaseClient } from "@supabase/supabase-js";

export async function getAdminMfaStatus(client: SupabaseClient) {
  const [assuranceResult, factorsResult] = await Promise.all([
    client.auth.mfa.getAuthenticatorAssuranceLevel(),
    client.auth.mfa.listFactors(),
  ]);

  if (assuranceResult.error || factorsResult.error || !assuranceResult.data || !factorsResult.data) {
    return {
      error: assuranceResult.error ?? factorsResult.error ?? new Error("Could not verify admin MFA status."),
      currentLevel: null,
      nextLevel: null,
      totpFactors: [],
    };
  }

  const totpFactors = factorsResult.data.totp;
  return {
    error: null,
    currentLevel: assuranceResult.data.currentLevel,
    nextLevel: assuranceResult.data.nextLevel,
    totpFactors,
  };
}

export function hasAdminTotpAal2(status: Awaited<ReturnType<typeof getAdminMfaStatus>>) {
  return !status.error &&
    status.currentLevel === "aal2" &&
    status.nextLevel === "aal2" &&
    status.totpFactors.some((factor) => factor.status === "verified");
}
