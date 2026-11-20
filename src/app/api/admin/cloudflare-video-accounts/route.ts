import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";
import { encryptCloudflareCredential, publicCloudflareVideoAccount, CloudflareVideoAccountRecord } from "@/lib/cloudflare-video-accounts";

export const dynamic = "force-dynamic";

async function adminClient() {
  try {
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return { error: "Admin authentication required", status: 401 } as const;
    const { data: admin, error: adminError } = await client.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (adminError || !admin) return { error: "Admin authorization required", status: 403 } as const;
    const mfa = await getAdminMfaStatus(client);
    if (mfa.error || !hasAdminTotpAal2(mfa)) return { error: "Authenticator verification required", status: 403 } as const;
    return { client } as const;
  } catch {
    return { error: "Could not verify admin access", status: 503 } as const;
  }
}

function validateAccountInput(body: Record<string, unknown>, requireCredentials: boolean) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const accountId = typeof body.accountId === "string" ? body.accountId.trim().toLowerCase() : "";
  const accessKeyId = typeof body.accessKeyId === "string" ? body.accessKeyId.trim() : "";
  const secretAccessKey = typeof body.secretAccessKey === "string" ? body.secretAccessKey : "";
  const bucketName = typeof body.bucketName === "string" ? body.bucketName.trim() : "";
  const publicUrl = typeof body.publicUrl === "string" ? body.publicUrl.trim() : "";
  if (!name || name.length > 100) throw new Error("Account name must be between 1 and 100 characters");
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error("Enter a valid 32-character Cloudflare account ID");
  if (requireCredentials && (!accessKeyId || !secretAccessKey)) throw new Error("Both R2 access keys are required");
  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) throw new Error("Enter both R2 access key values, or leave both empty to keep existing credentials");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName)) throw new Error("Enter a valid R2 bucket name");
  let publicBase: URL;
  try { publicBase = new URL(publicUrl); } catch { throw new Error("Enter a valid public HTTPS URL"); }
  if (publicBase.protocol !== "https:" || publicBase.username || publicBase.password || publicBase.search || publicBase.hash) throw new Error("Public URL must be HTTPS without credentials, query, or fragment");
  return {
    name,
    accountId,
    accessKeyId: accessKeyId || null,
    secretAccessKey: secretAccessKey || null,
    bucketName,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    publicUrl: publicBase.toString().replace(/\/$/, ""),
    isDefault: body.isDefault === true,
  };
}

export async function GET() {
  const auth = await adminClient();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const { data, error } = await auth.client.from("cloudflare_video_accounts").select("*").order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load video storage accounts" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ accounts: ((data ?? []) as CloudflareVideoAccountRecord[]).map(publicCloudflareVideoAccount) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = await adminClient();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await request.json() as Record<string, unknown>;
    const input = validateAccountInput(body, true);
    const { data: existing, error: listError } = await auth.client.from("cloudflare_video_accounts").select("id,is_default");
    if (listError) throw listError;
    const makeDefault = input.isDefault || !existing?.some((item) => item.is_default);
    if (makeDefault && existing?.some((item) => item.is_default)) {
      const { error } = await auth.client.from("cloudflare_video_accounts").update({ is_default: false, updated_at: new Date().toISOString() }).eq("is_default", true);
      if (error) throw error;
    }
    const { data, error } = await auth.client.from("cloudflare_video_accounts").insert({
      display_name: input.name,
      account_id: input.accountId,
      access_key_id_ciphertext: encryptCloudflareCredential(input.accessKeyId!),
      secret_access_key_ciphertext: encryptCloudflareCredential(input.secretAccessKey!),
      endpoint: input.endpoint,
      bucket_name: input.bucketName,
      public_url: input.publicUrl,
      is_default: makeDefault,
      is_active: true,
    }).select("*").single();
    if (error) throw error;
    return NextResponse.json({ account: publicCloudflareVideoAccount(data as CloudflareVideoAccountRecord) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add storage account";
    if (process.env.NODE_ENV === "development") console.error("[cloudflare-video-accounts] create failed", { message: message.slice(0, 120) });
    return NextResponse.json({ error: message.includes("CLOUDFLARE_ACCOUNT_ENCRYPTION_KEY") ? "Server credential-encryption secret is not configured." : message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await adminClient();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await request.json() as { id?: unknown; action?: unknown; name?: unknown; accountId?: unknown; accessKeyId?: unknown; secretAccessKey?: unknown; bucketName?: unknown; publicUrl?: unknown; isActive?: unknown };
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) return NextResponse.json({ error: "Invalid account ID" }, { status: 400 });
    if (body.action === "default") {
      const { data: target, error: targetError } = await auth.client.from("cloudflare_video_accounts").select("id,is_active").eq("id", body.id).maybeSingle();
      if (targetError || !target || !target.is_active) return NextResponse.json({ error: "Choose an active storage account" }, { status: 404 });
      const { error: clearError } = await auth.client.from("cloudflare_video_accounts").update({ is_default: false, updated_at: new Date().toISOString() }).eq("is_default", true);
      if (clearError) throw clearError;
      const { data, error } = await auth.client.from("cloudflare_video_accounts").update({ is_default: true, updated_at: new Date().toISOString() }).eq("id", body.id).select("*").single();
      if (error) throw error;
      return NextResponse.json({ account: publicCloudflareVideoAccount(data as CloudflareVideoAccountRecord) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "active") {
      const active = body.isActive === true;
      const { data: current, error: currentError } = await auth.client.from("cloudflare_video_accounts").select("id,is_default").eq("id", body.id).maybeSingle();
      if (currentError || !current) return NextResponse.json({ error: "Storage account not found" }, { status: 404 });
      if (!active && current.is_default) return NextResponse.json({ error: "Set another account as default before deactivating this one" }, { status: 409 });
      const { data, error } = await auth.client.from("cloudflare_video_accounts").update({ is_active: active, ...(active ? {} : { is_default: false }), updated_at: new Date().toISOString() }).eq("id", body.id).select("*").single();
      if (error) throw error;
      return NextResponse.json({ account: publicCloudflareVideoAccount(data as CloudflareVideoAccountRecord) }, { headers: { "Cache-Control": "no-store" } });
    }
    const { data: existing, error: getError } = await auth.client.from("cloudflare_video_accounts").select("*").eq("id", body.id).maybeSingle();
    if (getError || !existing) return NextResponse.json({ error: "Storage account not found" }, { status: 404 });
    const merged = validateAccountInput({
      name: body.name ?? existing.display_name,
      accountId: body.accountId ?? existing.account_id,
      accessKeyId: body.accessKeyId ?? "",
      secretAccessKey: body.secretAccessKey ?? "",
      bucketName: body.bucketName ?? existing.bucket_name,
      publicUrl: body.publicUrl ?? existing.public_url,
    }, false);
    if (merged.accountId !== existing.account_id && !merged.accessKeyId) {
      return NextResponse.json({ error: "Enter new access keys when changing the Cloudflare account ID" }, { status: 400 });
    }
    const update: Record<string, unknown> = { display_name: merged.name, account_id: merged.accountId, endpoint: merged.endpoint, bucket_name: merged.bucketName, public_url: merged.publicUrl, updated_at: new Date().toISOString() };
    if (merged.accessKeyId && merged.secretAccessKey) {
      update.access_key_id_ciphertext = encryptCloudflareCredential(merged.accessKeyId);
      update.secret_access_key_ciphertext = encryptCloudflareCredential(merged.secretAccessKey);
    }
    const { data, error } = await auth.client.from("cloudflare_video_accounts").update(update).eq("id", body.id).select("*").single();
    if (error) throw error;
    return NextResponse.json({ account: publicCloudflareVideoAccount(data as CloudflareVideoAccountRecord) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error("[cloudflare-video-accounts] update failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Could not update the storage account" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await adminClient();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid account ID" }, { status: 400 });
  const { data: account, error: getError } = await auth.client.from("cloudflare_video_accounts").select("id,is_default").eq("id", id).maybeSingle();
  if (getError || !account) return NextResponse.json({ error: "Storage account not found" }, { status: 404 });
  const { count: linkedVideos, error: videosError } = await auth.client.from("videos").select("id", { count: "exact", head: true }).eq("cloudflare_video_account_id", id);
  if (videosError) return NextResponse.json({ error: "Could not verify account usage" }, { status: 500 });
  if (linkedVideos) return NextResponse.json({ error: "This account is associated with saved videos. Deactivate it instead." }, { status: 409 });
  if (account.is_default) {
    const { data: next } = await auth.client.from("cloudflare_video_accounts").select("id").eq("is_active", true).neq("id", id).order("created_at", { ascending: true }).limit(1).maybeSingle();
    const { error: clearDefaultError } = await auth.client.from("cloudflare_video_accounts").update({ is_default: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (clearDefaultError) return NextResponse.json({ error: "Could not clear the default account before removal" }, { status: 500 });
    if (next) {
      const { error: setDefaultError } = await auth.client.from("cloudflare_video_accounts").update({ is_default: true, updated_at: new Date().toISOString() }).eq("id", next.id);
      if (setDefaultError) return NextResponse.json({ error: "Could not change the default account before removal" }, { status: 500 });
    }
  }
  const { error } = await auth.client.from("cloudflare_video_accounts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.code === "23503" ? "This account is associated with saved videos. Deactivate it instead." : "Could not remove the storage account" }, { status: error.code === "23503" ? 409 : 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
