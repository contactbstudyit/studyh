"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type Category = { id: string; name: string; description: string; image_url: string | null; created_at: string; updated_at: string; video_count?: number };
export type CategoryOption = Pick<Category, "id" | "name">;
export type VideoRecord = { id: string; title: string; video_url: string; description: string; thumbnail_url: string | null; category_id: string; tags: string[]; duration: string; views: number; featured: boolean; published: boolean; created_at: string; updated_at: string; categories?: { name: string } | null };
export type LibraryStats = { total_videos: number; published_videos: number; total_categories: number; total_views: number };
const PAGE_SIZE = 20;

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

export function useVideos(options: { categoryId?: string; search?: string; searchCategoryIds?: string[]; admin?: boolean; published?: boolean } = {}) {
  const { admin = false, categoryId, search, published } = options;
  const searchCategoryIds = options.searchCategoryIds?.join(",") ?? "";
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const fetchPage = useCallback(async (nextPage: number, append = false) => {
    setLoading(true);
    try {
      const client = createClient();
      let request = client.from("videos").select("*, categories(name)").order("created_at", { ascending: false }).range(nextPage * PAGE_SIZE, nextPage * PAGE_SIZE + PAGE_SIZE - 1);
      if (!admin) request = request.eq("published", true);
      else if (published !== undefined) request = request.eq("published", published);
      if (categoryId) request = request.eq("category_id", categoryId);
      const term = search?.trim().replace(/[^\p{L}\p{N} _-]/gu, " ").trim();
      if (term) {
        const categoryMatches = searchCategoryIds ? searchCategoryIds.split(",").map((id) => `category_id.eq.${id}`) : [];
        const tagMatch = !term.includes(" ") ? `,tags.cs.{${term}}` : "";
        request = request.or([`search_vector.wfts(english).${term}`, ...categoryMatches].join(",") + tagMatch);
      }
      const { data, error } = await request;
      if (error) throw error;
      const rows = (data ?? []) as VideoRecord[];
      setVideos((old) => append ? [...old, ...rows] : rows);
      setHasMore(rows.length === PAGE_SIZE); setPage(nextPage);
    } catch { toast.error("Could not load videos."); }
    finally { setLoading(false); }
  }, [admin, categoryId, search, searchCategoryIds, published]);
  useEffect(() => { void fetchPage(0); }, [fetchPage]);
  const refresh = useCallback(() => fetchPage(0), [fetchPage]);
  async function create(input: Omit<VideoRecord, "id" | "created_at" | "updated_at" | "views" | "categories">): Promise<VideoRecord | null> {
    try { const { data, error } = await createClient().from("videos").insert(input).select("*, categories(name)").single(); if (error) throw error; const video = data as VideoRecord; setVideos((old) => [video, ...old]); toast.success("Video added."); return video; }
    catch { toast.error("Could not add video. Check the URL and category."); return null; }
  }
  async function update(id: string, input: Partial<Omit<VideoRecord, "id" | "created_at" | "updated_at" | "categories">>) {
    try { const { data, error } = await createClient().from("videos").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id).select("*, categories(name)").single(); if (error) throw error; setVideos((old) => old.map((item) => item.id === id ? data as VideoRecord : item)); toast.success("Video updated."); return true; }
    catch { toast.error("Could not update video."); return false; }
  }
  async function remove(id: string): Promise<boolean> {
    try { const { error } = await createClient().from("videos").delete().eq("id", id); if (error) throw error; setVideos((old) => old.filter((item) => item.id !== id)); toast.success("Video deleted."); return true; }
    catch { toast.error("Could not delete video."); return false; }
  }
  async function recordView(id: string) {
    try {
      const keyName = "video_viewer_key";
      const match = document.cookie.match(new RegExp(`(?:^|; )${keyName}=([^;]*)`));
      const viewerKey = match?.[1] || crypto.randomUUID();
      if (!match) document.cookie = `${keyName}=${viewerKey}; Max-Age=31536000; Path=/; SameSite=Lax`;
      const { data, error } = await createClient().rpc("record_video_view", { p_video_id: id, p_viewer_key: viewerKey });
      if (error) throw error;
      if (data) setVideos((old) => old.map((video) => video.id === id ? { ...video, views: video.views + 1 } : video));
    } catch { /* View metrics are best-effort and never interrupt playback. */ }
  }
  const loadMore = () => { if (hasMore && !loading) void fetchPage(page + 1, true); };
  return { videos, loading, hasMore, refresh, loadMore, create, update, remove, recordView };
}
