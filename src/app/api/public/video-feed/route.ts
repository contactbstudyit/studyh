import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildDailyVideoFeed, dailyOrder } from "@/lib/daily-video-feed";
import { getPublicDisplayViews } from "@/lib/public-view-count-server";

export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FETCH_CHUNK = 500;

type FeedVideo = {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string | null;
  category_id: string;
  tags: string[];
  duration: string;
  views: number;
  display_view_count: number;
  display_views?: number;
  published_at: string | null;
  featured: boolean;
  published: boolean;
  created_at: string;
  updated_at: string;
  categories?: { name: string } | null;
};

function sortFeed(videos: FeedVideo[], sort: string, date: string, categoryId: string | null) {
  if (sort === "oldest") return [...videos].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  if (sort === "most-watched") return [...videos].sort((a, b) => b.views - a.views || a.id.localeCompare(b.id));
  if (sort === "least-watched") return [...videos].sort((a, b) => a.views - b.views || a.id.localeCompare(b.id));
  if (sort === "a-z") return [...videos].sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "z-a") return [...videos].sort((a, b) => b.title.localeCompare(a.title));
  if (sort === "random") return dailyOrder(videos, `${date}:${categoryId ?? "all"}:random`);
  return buildDailyVideoFeed(videos, date, categoryId);
}

function safePageNumber(value: string | null) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const categoryId = params.get("categoryId");
  const excludeId = params.get("excludeId");
  const search = (params.get("search") ?? "").trim().replace(/[^\p{L}\p{N} _-]/gu, " ").trim();
  const page = safePageNumber(params.get("page"));
  const pageSize = Math.max(1, Math.min(15, Number.parseInt(params.get("pageSize") ?? "15", 10) || 15));
  const sort = params.get("sort") ?? "latest";
  if (categoryId && !UUID_PATTERN.test(categoryId)) return NextResponse.json({ error: "Invalid category id" }, { status: 400 });
  if (excludeId && !UUID_PATTERN.test(excludeId)) return NextResponse.json({ error: "Invalid excluded video id" }, { status: 400 });

  try {
    const supabase = await createClient();
    let categoryMatches: string[] = [];
    if (search) {
      const { data, error } = await supabase.from("categories").select("id").ilike("name", `%${search}%`).limit(500);
      if (error) throw error;
      categoryMatches = (data ?? []).map((item) => item.id);
    }

    const rows: FeedVideo[] = [];
    for (let offset = 0; ; offset += FETCH_CHUNK) {
      let query = supabase.from("videos").select("id,title,description,thumbnail_url,category_id,tags,duration,views,display_view_count,published_at,featured,published,created_at,updated_at,categories(name)").eq("published", true);
      if (categoryId) query = query.eq("category_id", categoryId);
      if (excludeId) query = query.neq("id", excludeId);
      if (search) {
        const categoryFilters = categoryMatches.map((id) => `category_id.eq.${id}`);
        const tagFilter = !search.includes(" ") ? `,tags.cs.{${search}}` : "";
        query = query.or([`search_vector.wfts(english).${search}`, ...categoryFilters].join(",") + tagFilter);
      }
      const { data, error } = await query.order("created_at", { ascending: false }).range(offset, offset + FETCH_CHUNK - 1);
      if (error) throw error;
      const batch = (data ?? []).map((video) => {
        const category = video.categories;
        return { ...video, categories: Array.isArray(category) ? category[0] ?? null : category } as unknown as FeedVideo;
      });
      rows.push(...batch);
      if (batch.length < FETCH_CHUNK) break;
    }

    const today = new Date().toISOString().slice(0, 10);
    const feed = sortFeed(rows, sort, today, categoryId);
    const offset = (page - 1) * pageSize;
    const response = {
      videos: feed.slice(offset, offset + pageSize).map((video) => {
        const { views: _realViews, display_view_count: _displayBase, published_at: _publishedAt, ...publicVideo } = video;
        return { ...publicVideo, display_views: getPublicDisplayViews(video) };
      }),
      totalCount: feed.length,
      page,
      pageSize,
      hasMore: offset + pageSize < feed.length,
      dailySeed: `${today}:${categoryId ?? "all"}`,
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate video feed";
    if (process.env.NODE_ENV === "development") console.error("[public-video-feed] query failed", { categoryId, search, page, message });
    return NextResponse.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
