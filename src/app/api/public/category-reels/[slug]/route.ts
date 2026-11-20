import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicCategoryBySlug } from "@/lib/category-routes";
import { detectSourceType, getSourceHost, resolvePublicPlaybackUrl } from "@/lib/video-playback";
import { getPublicDisplayViews } from "@/lib/public-view-count-server";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 4;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readPage(value: string | null) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!slug || slug.length > 120) return NextResponse.json({ error: "Category not found" }, { status: 404 });

  try {
    const category = await getPublicCategoryBySlug(slug);
    if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });

    const page = readPage(request.nextUrl.searchParams.get("page"));
    const supabase = await createClient();
    const auth = await supabase.auth.getUser();
    const authenticatedVisitor = auth.data.user?.id;
    const headerVisitor = request.headers.get("x-reel-visitor-id") ?? "";
    const visitorId = authenticatedVisitor ?? (UUID_PATTERN.test(headerVisitor) ? headerVisitor : null);
    if (!visitorId) return NextResponse.json({ error: "A reel visitor identifier is required" }, { status: 400 });
    const excludeIds = request.nextUrl.searchParams.getAll("excludeId").filter((id) => UUID_PATTERN.test(id)).slice(0, 100);
    const { data, error } = await supabase.rpc("fresh_category_reels", {
      p_visitor_id: visitorId,
      p_category_id: category.id,
      p_page: excludeIds.length ? 1 : page,
      p_page_size: PAGE_SIZE,
      p_exclude_ids: excludeIds,
    });

    if (error) throw error;

    const videos = (data ?? []).map((row: typeof data[number]) => {
      const { video_url: sourceUrl, views: _realViews, display_view_count: _displayBase, published_at: _publishedAt, ...video } = row;
      return {
        video,
        playbackUrl: resolvePublicPlaybackUrl(sourceUrl),
        playbackType: detectSourceType(sourceUrl),
        sourceHost: getSourceHost(sourceUrl),
        displayViews: getPublicDisplayViews(row),
      };
    });

    return NextResponse.json({ videos, page, pageSize: PAGE_SIZE, hasMore: videos.length === PAGE_SIZE }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not load category reels" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
