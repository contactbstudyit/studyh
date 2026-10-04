import { redirect } from "next/navigation";
import AdminTotpMfa from "@/components/admin-totp-mfa";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminMfaPage() {
  const supabase = await createClient();
  const { data: verified } = await supabase.auth.getClaims();
  const userId = verified?.claims?.sub;
  if (!userId) redirect("/admin/login");

  const { data: membership, error: membershipError } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError || !membership) redirect("/admin/login");

  const mfaStatus = await getAdminMfaStatus(supabase);
  if (mfaStatus.error) redirect("/admin/login?mfaCheck=failed");
  if (hasAdminTotpAal2(mfaStatus)) redirect("/admin");

  const factors = mfaStatus.totpFactors.map((factor) => ({
    id: factor.id,
    friendlyName: factor.friendly_name ?? "Authenticator app",
  }));

  return <AdminTotpMfa mode={factors.length ? "challenge" : "enroll"} factors={factors} />;
}
