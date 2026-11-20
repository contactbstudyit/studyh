import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";
import { createVideoUploadTarget } from "@/lib/r2-storage";
import { CloudflareVideoAccountRecord, decryptCloudflareCredential } from "@/lib/cloudflare-video-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VIDEO_BYTES = 10 * 1024 * 1024 * 1024;

async function authorizeAdmin() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { error: "Admin authentication required", status: 401 } as const;
    const { data: membership, error: membershipError } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (membershipError || !membership) return { error: "Admin authorization required", status: 403 } as const;
    const mfaStatus = await getAdminMfaStatus(supabase);
    if (mfaStatus.error || !hasAdminTotpAal2(mfaStatus)) return { error: "Authenticator verification required", status: 403 } as const;
    return { supabase } as const;
  } catch {
    return { error: "Admin authorization could not be verified", status: 503 } as const;
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await request.json() as { filename?: unknown; contentType?: unknown; size?: unknown; storageAccountId?: unknown };
    if (typeof body.storageAccountId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.storageAccountId)) {
      return NextResponse.json({ error: "Choose a Cloudflare video storage account" }, { status: 400 });
    }
    const contentType = body.contentType;
    if (typeof body.filename !== "string" || body.filename.length < 1 || body.filename.length > 255) {
      return NextResponse.json({ error: "Choose a valid video filename" }, { status: 400 });
    }
    if (contentType !== "video/mp4" && contentType !== "video/webm") {
      return NextResponse.json({ error: "Only MP4 and WebM video uploads are supported" }, { status: 415 });
    }
    if (typeof body.size !== "number" || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: "Video file must be between 1 byte and 10 GB" }, { status: 413 });
    }

    const { data: row, error: accountError } = await auth.supabase.from("cloudflare_video_accounts").select("*").eq("id", body.storageAccountId).eq("is_active", true).maybeSingle();
    if (accountError || !row) return NextResponse.json({ error: "Selected Cloudflare account is unavailable" }, { status: 404 });
    const account = row as CloudflareVideoAccountRecord;
    const target = await createVideoUploadTarget({
      id: account.id,
      accountId: account.account_id,
      accessKeyId: decryptCloudflareCredential(account.access_key_id_ciphertext),
      secretAccessKey: decryptCloudflareCredential(account.secret_access_key_ciphertext),
      endpoint: account.endpoint,
      bucketName: account.bucket_name,
      publicUrl: account.public_url,
    }, body.filename, contentType, body.size);
    return NextResponse.json(target, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error("[admin-video-upload] Could not prepare direct video upload", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: error instanceof Error && error.message.includes("not configured") ? "Video storage is not configured yet. Check the second-account video R2 secrets." : "Could not prepare the video upload. Check the video R2 configuration and try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
