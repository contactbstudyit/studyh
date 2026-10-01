import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminDashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: verified } = await supabase.auth.getClaims();
  const claims = verified?.claims;
  if (!claims?.sub) redirect("/admin/login");
  const { data: membership } = await supabase.from("admins").select("user_id").eq("user_id", claims.sub).maybeSingle();
  if (!membership) redirect("/");
  return <AdminDashboard />;
}
