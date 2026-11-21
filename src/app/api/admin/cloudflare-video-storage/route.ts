import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";
import { deleteVideoR2Object, getVideoR2StorageUsage, listVideoR2Objects, listConfiguredVideoR2Accounts } from "@/lib/r2-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorizeAdmin() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return { error: "Admin authentication required", status: 401 } as const;
    const { data: admin, error: adminError } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (adminError || !admin) return { error: "Admin authorization required", status: 403 } as const;
    const mfa = await getAdminMfaStatus(supabase);
    if (mfa.error || !hasAdminTotpAal2(mfa)) return { error: "Authenticator verification required", status: 403 } as const;
    return { error: null, status: 200 } as const;
  } catch {
    return { error: "Could not verify admin access", status: 503 } as const;
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const slot = request.nextUrl.searchParams.get("slot") ?? "";
  const continuationToken = request.nextUrl.searchParams.get("cursor");
  const account = listConfiguredVideoR2Accounts().find((item) => item.id === slot);
  if (!account) return NextResponse.json({ error: "Select a configured Cloudflare account slot" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (continuationToken && continuationToken.length > 4096) return NextResponse.json({ error: "Invalid storage page cursor" }, { status: 400 });
  try {
    const [inventory, usage] = await Promise.all([listVideoR2Objects(slot, continuationToken), getVideoR2StorageUsage(slot)]);
    return NextResponse.json({ account: { id: account.id, name: account.name, bucketName: account.bucketName, publicUrl: account.publicUrl }, ...inventory, usage }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not inspect this R2 bucket. Verify the account’s ListBucket permission and account configuration." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  let body: { slot?: unknown; key?: unknown };
  try { body = await request.json() as { slot?: unknown; key?: unknown }; }
  catch { return NextResponse.json({ error: "Invalid object deletion request" }, { status: 400 }); }
  if (typeof body.slot !== "string" || typeof body.key !== "string") return NextResponse.json({ error: "Select an account and managed video object" }, { status: 400 });
  if (!listConfiguredVideoR2Accounts().some((account) => account.id === body.slot)) return NextResponse.json({ error: "Unknown Cloudflare account slot" }, { status: 400 });
  try {
    await deleteVideoR2Object(body.slot, body.key);
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error("[admin-video-storage] object deletion failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: error instanceof Error && error.message.includes("namespace") ? "Only objects created in the managed videos/ area can be deleted here." : "Could not delete the R2 object. Check the bucket DeleteObject permission and retry." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
