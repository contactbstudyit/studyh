import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;
const MAX_CATEGORY_VIDEO_IDS = 5000;

async function getAdminClient() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { client: null, error: "Admin authentication required", status: 401 };
    const { data: membership, error: membershipError } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (membershipError || !membership) return { client: null, error: "Admin authorization required", status: 403 };
    const mfaStatus = await getAdminMfaStatus(supabase);
    if (mfaStatus.error || !hasAdminTotpAal2(mfaStatus)) return { client: null, error: "Authenticator verification required", status: 403 };
    return { client: supabase, error: null, status: 200 };
  } catch {
    return { client: null, error: "Admin authorization could not be verified", status: 503 };
  }
}

async function readCategoryVideoIds(client: Awaited<ReturnType<typeof createClient>>, categoryId: string) {
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.from("videos").select("id").eq("category_id", categoryId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    ids.push(...(data ?? []).map((video) => video.id));
    if (ids.length > MAX_CATEGORY_VIDEO_IDS) throw new Error("Category contains too many videos for a single safe bulk-delete action");
    if (!data || data.length < PAGE_SIZE) return ids;
  }
}

export async function GET(request: NextRequest) {
  const auth = await getAdminClient();
  if (!auth.client) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const categoryId = request.nextUrl.searchParams.get("categoryId") ?? "";
  if (!UUID_PATTERN.test(categoryId)) return NextResponse.json({ error: "Select a valid category before bulk deletion" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const { data: category, error } = await auth.client.from("categories").select("id,name").eq("id", categoryId).maybeSingle();
    if (error) throw error;
    if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const videoIds = await readCategoryVideoIds(auth.client, categoryId);
    return NextResponse.json({ categoryId, categoryName: category.name, videoIds, count: videoIds.length }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load videos for this category" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAdminClient();
  if (!auth.client) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  let body: { categoryId?: unknown; videoIds?: unknown; code?: unknown };
  try { body = await request.json() as { categoryId?: unknown; videoIds?: unknown; code?: unknown }; }
  catch { return NextResponse.json({ error: "Invalid bulk-delete request" }, { status: 400 }); }
  if (typeof body.categoryId !== "string" || !UUID_PATTERN.test(body.categoryId)) return NextResponse.json({ error: "Select a valid category" }, { status: 400 });
  if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) return NextResponse.json({ error: "Enter a valid 6-digit authenticator code" }, { status: 400 });
  if (!Array.isArray(body.videoIds) || body.videoIds.length === 0 || body.videoIds.length > MAX_CATEGORY_VIDEO_IDS || body.videoIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Invalid video selection" }, { status: 400 });
  }

  const expectedIds = [...new Set(body.videoIds as string[])];
  try {
    const mfaStatus = await getAdminMfaStatus(auth.client);
    const factorId = mfaStatus.totpFactors.find((factor) => factor.status === "verified")?.id;
    if (mfaStatus.error || !factorId) return NextResponse.json({ error: "A verified authenticator is required" }, { status: 403 });
    const { data: challenge, error: challengeError } = await auth.client.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) return NextResponse.json({ error: "Could not start authenticator verification" }, { status: 503 });
    const { error: verifyError } = await auth.client.auth.mfa.verify({ factorId, challengeId: challenge.id, code: body.code });
    if (verifyError) return NextResponse.json({ error: "One-time code is invalid or expired" }, { status: 401 });

    const assurance = await getAdminMfaStatus(auth.client);
    if (assurance.error || !hasAdminTotpAal2(assurance)) return NextResponse.json({ error: "Authenticator verification could not be confirmed" }, { status: 403 });
    const { data: { user }, error: userError } = await auth.client.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Admin authentication expired" }, { status: 401 });
    const { data: membership, error: membershipError } = await auth.client.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (membershipError || !membership) return NextResponse.json({ error: "Admin authorization required" }, { status: 403 });

    const { data: currentIds, error: currentError } = await auth.client.from("videos").select("id").eq("category_id", body.categoryId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, MAX_CATEGORY_VIDEO_IDS);
    if (currentError) throw currentError;
    const currentSet = new Set((currentIds ?? []).map((video) => video.id));
    if (currentSet.size > MAX_CATEGORY_VIDEO_IDS) return NextResponse.json({ error: "Category contains too many videos for one confirmed delete" }, { status: 413 });
    if (currentSet.size !== expectedIds.length || expectedIds.some((id) => !currentSet.has(id))) {
      return NextResponse.json({ error: "The category changed after confirmation. Review the updated count and confirm again." }, { status: 409 });
    }

    const { data: deleted, error: deleteError } = await auth.client.from("videos").delete().eq("category_id", body.categoryId).in("id", expectedIds).select("id");
    if (deleteError) throw deleteError;
    if ((deleted ?? []).length !== expectedIds.length) return NextResponse.json({ error: "The category changed during deletion. Refresh and review the remaining videos." }, { status: 409 });
    return NextResponse.json({ categoryId: body.categoryId, deletedCount: deleted.length }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Bulk deletion failed. No video metadata was changed outside the selected category." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
