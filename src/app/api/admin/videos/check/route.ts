import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";
import { checkVideoSourceWithRetry, VideoSourceCheck, VideoSourceForCheck } from "@/lib/admin-video-source-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;
const MAX_UNPUBLISH_IDS = 1000;

async function getAdminClient() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { client: null, error: "Admin authentication required", status: 401 };
    const { data: membership, error: membershipError } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (membershipError) return { client: null, error: "Admin authorization could not be verified", status: 403 };
    if (!membership) return { client: null, error: "Admin authorization required", status: 403 };
    const mfaStatus = await getAdminMfaStatus(supabase);
    if (mfaStatus.error || !hasAdminTotpAal2(mfaStatus)) return { client: null, error: "Authenticator verification required", status: 403 };
    return { client: supabase, error: null, status: 200 };
  } catch {
    return { client: null, error: "Admin authorization could not be verified", status: 503 };
  }
}

function internalCheckError() {
  return NextResponse.json({ error: "The secure video checker encountered an internal error. No videos were unpublished." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

function checkResponse(videoId: string, title: string, result: VideoSourceCheck) {
  return { videoId, title, status: result.status, reason: result.reason };
}

function getInternalAppOrigin(request: NextRequest) {
  const configuredHost = process.env.VERCEL_ENV === "production"
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
    : process.env.VERCEL_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (!configuredHost) {
    const hostname = request.nextUrl.hostname.replace(/^\[|\]$/g, "");
    return process.env.NODE_ENV === "development" || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
      ? request.nextUrl.origin
      : null;
  }
  try {
    const configuredUrl = new URL(/^https?:\/\//i.test(configuredHost) ? configuredHost : `https://${configuredHost}`);
    if (configuredUrl.protocol !== "https:" || configuredUrl.username || configuredUrl.password || configuredUrl.port && configuredUrl.port !== "443") return null;
    return configuredUrl.origin;
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await getAdminClient();
  if (!auth.client) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const videos: Array<{ id: string; title: string }> = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await auth.client.from("videos").select("id,title").eq("published", true).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      videos.push(...(data ?? []) as Array<{ id: string; title: string }>);
      if (!data || data.length < PAGE_SIZE) break;
    }
    return NextResponse.json({ videos }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load published videos for checking" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAdminClient();
  if (!auth.client) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: { videoId?: unknown };
  try { body = await request.json() as { videoId?: unknown }; }
  catch { return NextResponse.json({ error: "Invalid check request" }, { status: 400 }); }
  const videoId = body.videoId;
  if (typeof videoId !== "string" || !UUID_PATTERN.test(videoId)) return NextResponse.json({ error: "Invalid video id" }, { status: 400 });

  try {
    const { data: video, error } = await auth.client.from("videos").select("id,title,video_url,published").eq("id", videoId).maybeSingle();
    if (error) throw error;
    if (!video || !video.published) return NextResponse.json({ videoId, title: video?.title ?? "Video", status: "skipped", reason: "Video is no longer published" }, { headers: { "Cache-Control": "no-store" } });
    const origin = getInternalAppOrigin(request);
    if (!origin) return internalCheckError();
    const result = await checkVideoSourceWithRetry(video as VideoSourceForCheck, origin);
    if (result.status === "internal") return internalCheckError();
    return NextResponse.json(checkResponse(video.id, video.title, result), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return internalCheckError();
  }
}

export async function PUT(request: NextRequest) {
  const auth = await getAdminClient();
  if (!auth.client) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: { videoIds?: unknown };
  try { body = await request.json() as { videoIds?: unknown }; }
  catch { return NextResponse.json({ error: "Invalid unpublish request" }, { status: 400 }); }
  const requestedIds = body.videoIds;
  if (!Array.isArray(requestedIds) || requestedIds.length === 0 || requestedIds.length > MAX_UNPUBLISH_IDS || requestedIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Invalid video ids" }, { status: 400 });
  }
  const videoIds = [...new Set(requestedIds as string[])];

  try {
    const { data, error } = await auth.client.from("videos").select("id,title,video_url,published").in("id", videoIds).eq("published", true);
    if (error) throw error;
    const currentVideos = (data ?? []) as Array<VideoSourceForCheck & { title: string; published: boolean }>;
    const origin = getInternalAppOrigin(request);
    if (currentVideos.length && !origin) return internalCheckError();
    const checked = new Map<string, { title: string; result: VideoSourceCheck }>();
    for (const video of currentVideos) {
      const result = await checkVideoSourceWithRetry(video, origin!);
      if (result.status === "internal") return internalCheckError();
      checked.set(video.id, { title: video.title, result });
    }

    const brokenIds = [...checked.entries()].filter(([, item]) => item.result.status === "broken").map(([id]) => id);
    let unpublishedIds = new Set<string>();
    if (brokenIds.length) {
      const { data: changed, error: updateError } = await auth.client.from("videos").update({ published: false }).in("id", brokenIds).eq("published", true).select("id");
      if (updateError) throw updateError;
      unpublishedIds = new Set((changed ?? []).map((row) => row.id as string));
    }

    const results = videoIds.map((id) => {
      const item = checked.get(id);
      if (!item) return { videoId: id, title: "Video", status: "skipped", reason: "Video is already unpublished or no longer exists" };
      if (item.result.status === "broken") {
        return unpublishedIds.has(id)
          ? { videoId: id, title: item.title, status: "unpublished", reason: item.result.reason }
          : { videoId: id, title: item.title, status: "skipped", reason: "Publication status changed before the update" };
      }
      return checkResponse(id, item.title, item.result);
    });
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The secure video checker or publication update failed. No videos were unpublished by this request." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
