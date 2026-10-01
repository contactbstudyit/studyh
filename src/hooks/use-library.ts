"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type Category = { id: string; name: string; description: string; image_url: string | null; created_at: string; updated_at: string; video_count?: number };
export type CategoryOption = Pick<Category, "id" | "name">;
export type VideoRecord = { id: string; title: string; video_url: string; description: string; thumbnail_url: string | null; category_id: string; tags: string[]; duration: string; views: number; display_view_count: number; display_views?: number; published_at: string | null; featured: boolean; published: boolean; created_at: string; updated_at: string; categories?: { name: string } | null };
export type LibraryStats = { total_videos: number; published_videos: number; total_categories: number; total_views: number };
export type VideoSort = "latest" | "oldest" | "most-watched" | "least-watched" | "a-z" | "z-a" | "random" | "most-liked" | "highest-rated" | "lowest-rated";
const PAGE_SIZE = 20;

export async function recordPublicVideoView(id: string) {
  try {
    const cookieName = "video_viewer_key";
    const cookie = document.cookie.match(new RegExp(`(?:^|; )${cookieName}=([^;]*)`));
    const viewerKey = cookie?.[1] || crypto.randomUUID();
    if (!cookie) document.cookie = `${cookieName}=${viewerKey}; Max-Age=31536000; Path=/; SameSite=Lax`;
    const { data, error } = await createClient().rpc("record_video_view", { p_video_id: id, p_viewer_key: viewerKey });
    if (error) throw error;
    return Boolean(data);
  } catch { return false; }
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const client = createClient();
      const all: Category[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from("categories").select("*, videos(count)").order("name").range(offset, offset + 499);
        if (error) throw error;
        const rows = (data ?? []).map((row) => { const item = row as unknown as Category & { videos?: { count: number }[] }; return { ...item, video_count: item.videos?.[0]?.count ?? 0 }; });
        all.push(...rows);
        if (rows.length < 500) break;
      }
      setCategories(all);
      setErrorMessage("");
    } catch (error) {
      const info = describeSupabaseError(error);
      setErrorMessage(info);
      if (process.env.NODE_ENV === "development") console.error("[admin-categories] load failed", info);
      toast.error(`Could not load categories: ${info}`);
    }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function create(input: Pick<Category, "name" | "description" | "image_url">): Promise<{ category: Category | null; error: string | null }> {
    try {
      const { data, error } = await createClient().from("categories").insert(input).select().single();
      if (error) throw error;
      const category = data as Category;
      setCategories((old) => [...old, category].sort((a, b) => a.name.localeCompare(b.name)));
      setErrorMessage(""); toast.success("Category created"); return { category, error: null };
    } catch (error) {
      const info = describeSupabaseError(error);
      const message = error && typeof error === "object" && "code" in error && error.code === "23505" ? "A category with this name already exists." : info;
      setErrorMessage(message);
      if (process.env.NODE_ENV === "development") console.error("[admin-categories] create failed", info);
      toast.error(message);
      return { category: null, error: message };
    }
  }
  async function update(id: string, input: Partial<Pick<Category, "name" | "description" | "image_url">>) {
    try { const { data, error } = await createClient().from("categories").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id).select().single(); if (error) throw error; setCategories((old) => old.map((item) => item.id === id ? data as Category : item).sort((a, b) => a.name.localeCompare(b.name))); setErrorMessage(""); toast.success("Category updated."); return true; }
    catch (error) { const info = describeSupabaseError(error); const message = error && typeof error === "object" && "code" in error && error.code === "23505" ? "A category with this name already exists." : info; setErrorMessage(message); if (process.env.NODE_ENV === "development") console.error("[admin-categories] update failed", info); toast.error(message); return false; }
  }
  async function remove(id: string) {
    try { const { count, error: countError } = await createClient().from("videos").select("id", { count: "exact", head: true }).eq("category_id", id); if (countError) throw countError; if (count) { toast.error("Move or delete its videos before removing this category."); return false; } const { error } = await createClient().from("categories").delete().eq("id", id); if (error) throw error; setCategories((old) => old.filter((item) => item.id !== id)); toast.success("Category deleted."); return true; }
    catch (error) { const info = describeSupabaseError(error); setErrorMessage(info); if (process.env.NODE_ENV === "development") console.error("[admin-categories] delete failed", info); toast.error(info); return false; }
  }
  return { categories, loading, errorMessage, setErrorMessage, refresh, create, update, remove };
}

export function useCategoryOptions() {
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    const development = process.env.NODE_ENV === "development";
    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "missing";
    let projectHost = "invalid Supabase URL";
    try { projectHost = new URL(projectUrl).host; } catch { /* URL diagnostics report invalid configuration below. */ }
    try {
      const client = createClient();
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData.user?.id) {
        const authInfo = authError ? describeSupabaseError(authError) : "No authenticated user returned";
        if (development) console.error("[admin-category-options] authenticated user lookup failed", { projectUrl, projectHost, userId: authData.user?.id ?? null, error: authInfo });
        throw new Error(`Could not verify admin session before loading categories: ${authInfo}`);
      }
      const userId = authData.user.id;
      if (development) console.info("[admin-category-options] query started", { projectUrl, projectHost, userId, query: "categories.select(id,name).order(name, ascending)" });
      const all: CategoryOption[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error: queryError } = await client.from("categories").select("id,name").order("name", { ascending: true }).range(offset, offset + 499);
        if (development) console.info("[admin-category-options] query response", { userId, projectHost, offset, data, error: queryError ? { message: queryError.message, code: queryError.code, details: queryError.details, hint: queryError.hint } : null, count: data?.length ?? 0 });
        if (queryError) throw queryError;
        all.push(...((data ?? []) as CategoryOption[]));
        if (!data || data.length < 500) break;
      }
      setCategories(all);
      if (development) console.info("[admin-category-options] state update scheduled", { userId, projectHost, categories: all, count: all.length });
      return all;
    } catch (error) {
      const info = describeSupabaseError(error);
      setError(info);
      if (development) console.error("[admin-category-options] load failed", { projectUrl, projectHost, error: info });
      return null;
    } finally { setLoading(false); }
  }, []);
  function add(category: CategoryOption) {
    setCategories((old) => old.some((item) => item.id === category.id) ? old : [...old, category].sort((a, b) => a.name.localeCompare(b.name)));
  }
  return { categories, loading, error, refresh, add };
}

function describeSupabaseError(error: unknown) {
  if (!error || typeof error !== "object") return String(error || "Unknown Supabase error");
  const item = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  return [item.message, item.code && `code=${String(item.code)}`, item.details && `details=${String(item.details)}`, item.hint && `hint=${String(item.hint)}`].filter(Boolean).join(" · ") || "Unknown Supabase error";
}

export function useLibraryStats() {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const refresh = useCallback(async () => {
    try {
      const { data, error } = await createClient().rpc("library_dashboard_stats");
      if (error) throw error;
      if (data?.[0]) setStats(data[0] as LibraryStats);
    } catch { toast.error("Could not load dashboard statistics."); }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { stats, refresh };
}

export function useVideos(options: { categoryId?: string; search?: string; searchCategoryIds?: string[]; admin?: boolean; published?: boolean; enabled?: boolean; sort?: VideoSort; pageNumber?: number; pageSize?: number; dailyFeed?: boolean } = {}) {
  const { admin = false, categoryId, search, published, enabled = true, sort = "latest", pageNumber, pageSize = PAGE_SIZE, dailyFeed = false } = options;
  const searchCategoryIds = options.searchCategoryIds?.join(",") ?? "";
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const fetchPage = useCallback(async (nextPage: number, append = false) => {
    setLoading(true);
    const currentPage = pageNumber === undefined ? nextPage : Math.max(1, pageNumber) - 1;
    const currentPageSize = pageNumber === undefined ? PAGE_SIZE : pageSize;
    if (pageNumber !== undefined && !append) setVideos([]);
    try {
      if (dailyFeed && !admin) {
        const params = new URLSearchParams({ page: String(currentPage + 1), pageSize: String(currentPageSize), sort });
        if (categoryId) params.set("categoryId", categoryId);
        if (search?.trim()) params.set("search", search.trim());
        const response = await fetch(`/api/public/video-feed?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json() as { videos?: VideoRecord[]; totalCount?: number; hasMore?: boolean; error?: string };
        if (!response.ok) throw new Error(payload.error || "Video feed request failed");
        const rows = payload.videos ?? [];
        setVideos((old) => append ? [...old, ...rows] : rows);
        setTotalCount(payload.totalCount ?? 0);
        setHasMore(Boolean(payload.hasMore));
        setPage(currentPage);
        return;
      }
      const client = createClient();
      let request = client.from("videos").select("*, categories(name)", pageNumber === undefined ? undefined : { count: "exact" });
      if (sort === "oldest") request = request.order("created_at", { ascending: true });
      else if (sort === "most-watched") request = request.order("views", { ascending: false }).order("created_at", { ascending: false });
      else if (sort === "least-watched") request = request.order("views", { ascending: true }).order("created_at", { ascending: false });
      else if (sort === "a-z") request = request.order("title", { ascending: true });
      else if (sort === "z-a") request = request.order("title", { ascending: false });
      else request = request.order("created_at", { ascending: false });
      if (!admin) request = request.eq("published", true);
      else if (published !== undefined) request = request.eq("published", published);
      if (categoryId) request = request.eq("category_id", categoryId);
      const term = search?.trim().replace(/[^\p{L}\p{N} _-]/gu, " ").trim();
      if (term) {
        const categoryMatches = searchCategoryIds ? searchCategoryIds.split(",").map((id) => `category_id.eq.${id}`) : [];
        const tagMatch = !term.includes(" ") ? `,tags.cs.{${term}}` : "";
        request = request.or([`search_vector.wfts(english).${term}`, ...categoryMatches].join(",") + tagMatch);
      }
      request = request.range(currentPage * currentPageSize, currentPage * currentPageSize + currentPageSize - 1);
      const { data, error, count } = await request;
      if (error) throw error;
      const rows = (data ?? []) as VideoRecord[];
      setVideos((old) => append ? [...old, ...rows] : rows);
      if (pageNumber !== undefined) {
        const exactCount = count ?? 0;
        setTotalCount(exactCount);
        setHasMore((currentPage + 1) * currentPageSize < exactCount);
      } else {
        setHasMore(rows.length === PAGE_SIZE);
        setTotalCount(null);
      }
      setPage(currentPage);
    } catch { toast.error("Could not load videos."); }
    finally { setLoading(false); }
  }, [admin, categoryId, search, searchCategoryIds, published, sort, pageNumber, pageSize, dailyFeed]);
  useEffect(() => { if (enabled) void fetchPage(pageNumber === undefined ? 0 : Math.max(1, pageNumber) - 1); }, [enabled, fetchPage, pageNumber]);
  const refresh = useCallback(() => fetchPage(pageNumber === undefined ? 0 : Math.max(1, pageNumber) - 1), [fetchPage, pageNumber]);
  async function create(input: Omit<VideoRecord, "id" | "created_at" | "updated_at" | "views" | "display_view_count" | "published_at" | "display_views" | "categories">): Promise<VideoRecord | null> {
    try { const { data, error } = await createClient().from("videos").insert(input).select("*, categories(name)").single(); if (error) throw error; const video = data as VideoRecord; setVideos((old) => [video, ...old]); return video; }
    catch { toast.error("Could not add video. Check the URL and category."); return null; }
  }
  async function update(id: string, input: Partial<Omit<VideoRecord, "id" | "created_at" | "updated_at" | "views" | "display_view_count" | "published_at" | "display_views" | "categories">>) {
    try { const { data, error } = await createClient().from("videos").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id).select("*, categories(name)").single(); if (error) throw error; setVideos((old) => old.map((item) => item.id === id ? data as VideoRecord : item)); toast.success("Video updated."); return true; }
    catch { toast.error("Could not update video."); return false; }
  }
  async function remove(id: string): Promise<boolean> {
    try { const { error } = await createClient().from("videos").delete().eq("id", id); if (error) throw error; setVideos((old) => old.filter((item) => item.id !== id)); toast.success("Video deleted."); return true; }
    catch { toast.error("Could not delete video."); return false; }
  }
  async function getMissingThumbnails(): Promise<Pick<VideoRecord, "id" | "title" | "video_url" | "duration" | "thumbnail_url">[] | null> {
    try {
      const client = createClient();
      const found = new Map<string, Pick<VideoRecord, "id" | "title" | "video_url" | "duration" | "thumbnail_url">>();
      for (const empty of [false, true]) {
        for (let offset = 0; ; offset += 500) {
          let query = client.from("videos").select("id,title,video_url,duration,thumbnail_url").order("created_at", { ascending: false }).range(offset, offset + 499);
          query = empty ? query.eq("thumbnail_url", "") : query.is("thumbnail_url", null);
          const { data, error } = await query;
          if (error) throw error;
          for (const video of (data ?? []) as Pick<VideoRecord, "id" | "title" | "video_url" | "duration" | "thumbnail_url">[]) found.set(video.id, video);
          if (!data || data.length < 500) break;
        }
      }
      return [...found.values()];
    } catch (error) {
      const detail = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
      if (process.env.NODE_ENV === "development") console.error("[video-thumbnail] missing-video query failed", error);
      toast.error(`Could not load videos missing thumbnails: ${detail}`);
      return null;
    }
  }
  async function recordView(id: string) {
    const counted = await recordPublicVideoView(id);
    if (counted) setVideos((old) => old.map((video) => video.id === id ? { ...video, views: video.views + 1 } : video));
  }
  const loadMore = () => { if (hasMore && !loading) void fetchPage(page + 1, true); };
  return { videos, loading, hasMore, page, totalCount, refresh, loadMore, create, update, remove, getMissingThumbnails, recordView };
}

export function useRecommendedVideos(currentVideo: Pick<VideoRecord, "id" | "category_id">) {
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const requestLock = useRef(false);
  const requestGeneration = useRef(0);
  const pageRef = useRef(1);

  const loadNext = useCallback(async (reset = false) => {
    if (reset) { requestGeneration.current++; requestLock.current = false; pageRef.current = 1; }
    if (requestLock.current) return;
    const generation = requestGeneration.current;
    const page = pageRef.current;
    requestLock.current = true;
    if (reset) setInitialLoading(true); else setLoadingMore(true);
    setError("");
    try {
      const params = new URLSearchParams({ categoryId: currentVideo.category_id, excludeId: currentVideo.id, page: String(page), pageSize: "5", sort: "latest" });
      const response = await fetch(`/api/public/video-feed?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as { videos?: VideoRecord[]; hasMore?: boolean; error?: string };
      if (generation !== requestGeneration.current) return;
      if (!response.ok) throw new Error(payload.error || "Recommendation feed request failed");
      const batch = payload.videos ?? [];
      setVideos((old) => reset ? batch : [...old, ...batch]);
      setHasMore(Boolean(payload.hasMore));
      pageRef.current = page + 1;
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      const detail = cause && typeof cause === "object" && "message" in cause ? String(cause.message) : String(cause);
      setError(detail);
      if (process.env.NODE_ENV === "development") console.error("[video-recommendations] load failed", { currentVideoId: currentVideo.id, categoryId: currentVideo.category_id, message: detail });
      toast.error(`Could not load recommended videos: ${detail}`);
    } finally {
      if (generation === requestGeneration.current) {
        requestLock.current = false;
        setInitialLoading(false);
        setLoadingMore(false);
      }
    }
  }, [currentVideo.category_id, currentVideo.id]);

  useEffect(() => {
    setVideos([]); setHasMore(false); setError(""); setInitialLoading(true);
    void loadNext(true);
  }, [loadNext]);

  return { videos, loading: initialLoading, loadingMore, hasMore, error, loadMore: () => void loadNext(false) };
}
