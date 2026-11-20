import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";
import { listConfiguredVideoR2Accounts } from "@/lib/r2-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Admin authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { data: admin, error: adminError } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (adminError || !admin) return NextResponse.json({ error: "Admin authorization required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const mfa = await getAdminMfaStatus(supabase);
    if (mfa.error || !hasAdminTotpAal2(mfa)) return NextResponse.json({ error: "Authenticator verification required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ accounts: listConfiguredVideoR2Accounts() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read the configured video account slots" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
