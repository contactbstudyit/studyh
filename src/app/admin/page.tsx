import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";
import AdminDashboard from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: verified } = await supabase.auth.getClaims();
  const claims = verified?.claims;
  if (!claims?.sub) redirect("/admin/login");
  const { data: membership, error } = await supabase.from("admins").select("user_id").eq("user_id", claims.sub).maybeSingle();
  if (error) {
    if (process.env.NODE_ENV === "development") console.error("[admin-auth] server membership query failed", {
      projectHost: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host,
      userId: claims.sub,
      table: "public.admins",
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    redirect("/admin/login?membershipCheck=failed");
  }
  if (!membership) {
    if (process.env.NODE_ENV === "development") console.warn("[admin-auth] server membership query returned no row", {
      projectHost: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host,
      userId: claims.sub,
      table: "public.admins",
      result: membership,
    });
    redirect("/");
  }

  const mfaStatus = await getAdminMfaStatus(supabase);
  if (mfaStatus.error || !hasAdminTotpAal2(mfaStatus)) redirect("/admin/login/mfa");

  return <AdminDashboard />;
}
