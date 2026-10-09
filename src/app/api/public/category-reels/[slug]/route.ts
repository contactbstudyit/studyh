import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicCategoryBySlug } from "@/lib/category-routes";
import { detectSourceType, getSourceHost, resolvePublicPlaybackUrl } from "@/lib/video-playback";
import { getPublicDisplayViews } from "@/lib/public-view-count-server";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 4;

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
    const start = (page - 1) * PAGE_SIZE;
    const supabase = await createClient();
    const { data, count, error } = await supabase
      .from("videos")
      .select("id,title,description,thumbnail_url,category_id,tags,duration,views,display_view_count,published_at,featured,published,created_at,updated_at,video_url", { count: "exact" })
      .eq("category_id", category.id)
      .eq("published", true)
      .order("created_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);

    if (error) throw error;

    const videos = (data ?? []).map((row) => {
      const { video_url: sourceUrl, views: _realViews, display_view_count: _displayBase, published_at: _publishedAt, ...video } = row;
      return {
        video,
        playbackUrl: resolvePublicPlaybackUrl(sourceUrl),
        playbackType: detectSourceType(sourceUrl),
        sourceHost: getSourceHost(sourceUrl),
        displayViews: getPublicDisplayViews(row),
      };
    });

    return NextResponse.json({ videos, page, pageSize: PAGE_SIZE, hasMore: start + videos.length < (count ?? 0) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not load category reels" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
