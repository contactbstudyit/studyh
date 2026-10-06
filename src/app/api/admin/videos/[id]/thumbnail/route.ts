import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteGeneratedThumbnail, saveGeneratedThumbnail } from "@/lib/r2-storage";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_IMAGE_BYTES = 300_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getAdminClient() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { client: null, error: "Admin authentication required", status: 401 };
  const { data: membership, error: membershipError } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) return { client: null, error: "Admin authorization could not be verified", status: 403 };
  if (!membership) return { client: null, error: "Admin authorization required", status: 403 };
  const mfaStatus = await getAdminMfaStatus(supabase);
  if (mfaStatus.error || !hasAdminTotpAal2(mfaStatus)) return { client: null, error: "Authenticator verification required", status: 403 };
  return { client: supabase, error: null, status: 200 };
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  const auth = await getAdminClient();
  if (!auth.client) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "image/webp" && contentType !== "image/jpeg") return NextResponse.json({ error: "Thumbnail must be a JPEG or WebP image" }, { status: 415 });
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Thumbnail image exceeds the size limit" }, { status: 413 });

  try {
    const { data: video, error: videoError } = await auth.client.from("videos").select("id,thumbnail_url").eq("id", id).maybeSingle();
    if (videoError) throw videoError;
    if (!video) return NextResponse.json({ error: "Video not found or not accessible" }, { status: 404 });
    const previousThumbnail = video.thumbnail_url as string | null;
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Thumbnail image is empty or exceeds the size limit" }, { status: 413 });
    const isJpeg = contentType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    const isWebp = contentType === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!isJpeg && !isWebp) return NextResponse.json({ error: "Thumbnail image signature does not match its content type" }, { status: 415 });

    const stored = await saveGeneratedThumbnail(id, bytes, contentType as "image/jpeg" | "image/webp");
    let update = auth.client.from("videos").update({ thumbnail_url: stored.url, updated_at: new Date().toISOString() }).eq("id", id);
    update = previousThumbnail !== null ? update.eq("thumbnail_url", previousThumbnail) : update.is("thumbnail_url", null);
    const { data: updated, error: updateError } = await update.select("id").maybeSingle();
    if (updateError || !updated) {
      await deleteGeneratedThumbnail(id, stored.url).catch(() => undefined);
      if (updateError) throw updateError;
      return NextResponse.json({ error: "Video thumbnail changed before the generated image could be saved" }, { status: 409 });
    }
    if (previousThumbnail && previousThumbnail !== stored.url) {
      await deleteGeneratedThumbnail(id, previousThumbnail).catch((error) => {
        if (process.env.NODE_ENV === "development") console.warn("[video-thumbnail] previous generated object cleanup failed", { videoId: id, errorType: error instanceof Error ? error.name : "UnknownError" });
      });
    }
    return NextResponse.json({ thumbnail_url: stored.url }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const missingStorage = error instanceof Error && error.message.includes("Persistent R2 thumbnail storage is not configured");
    if (process.env.NODE_ENV === "development") console.error("[video-thumbnail] R2 upload failed", { videoId: id, errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: missingStorage ? "Thumbnail storage is not configured" : "Thumbnail could not be saved" }, { status: missingStorage ? 503 : 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  const auth = await getAdminClient();
  if (!auth.client) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { data: video, error } = await auth.client.from("videos").select("id,thumbnail_url").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!video) return NextResponse.json({ error: "Video not found or not accessible" }, { status: 404 });
    const deleted = video.thumbnail_url ? await deleteGeneratedThumbnail(id, video.thumbnail_url) : false;
    return NextResponse.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error("[video-thumbnail] R2 delete failed", { videoId: id, errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Generated thumbnail could not be deleted" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
