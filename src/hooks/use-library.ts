"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type Category = { id: string; name: string; description: string; image_url: string | null; created_at: string; updated_at: string; video_count?: number };
export type VideoRecord = { id: string; title: string; video_url: string; description: string; thumbnail_url: string | null; category_id: string; tags: string[]; duration: string; views: number; featured: boolean; published: boolean; created_at: string; updated_at: string; categories?: { name: string } | null };
export type LibraryStats = { total_videos: number; published_videos: number; total_categories: number; total_views: number };
const PAGE_SIZE = 20;

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
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
    } catch { toast.error("Could not load categories."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function create(input: Pick<Category, "name" | "description" | "image_url">) {
    try { const { data, error } = await createClient().from("categories").insert(input).select().single(); if (error) throw error; setCategories((old) => [...old, data as Category].sort((a, b) => a.name.localeCompare(b.name))); toast.success("Category created."); return true; }
    catch { toast.error("Could not create category."); return false; }
  }
  async function update(id: string, input: Partial<Pick<Category, "name" | "description" | "image_url">>) {
    try { const { data, error } = await createClient().from("categories").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id).select().single(); if (error) throw error; setCategories((old) => old.map((item) => item.id === id ? data as Category : item).sort((a, b) => a.name.localeCompare(b.name))); toast.success("Category updated."); return true; }
    catch { toast.error("Could not update category."); return false; }
  }
  async function remove(id: string) {
    try { const { count, error: countError } = await createClient().from("videos").select("id", { count: "exact", head: true }).eq("category_id", id); if (countError) throw countError; if (count) { toast.error("Move or delete its videos before removing this category."); return false; } const { error } = await createClient().from("categories").delete().eq("id", id); if (error) throw error; setCategories((old) => old.filter((item) => item.id !== id)); toast.success("Category deleted."); return true; }
    catch { toast.error("Could not delete category."); return false; }
  }
  return { categories, loading, refresh, create, update, remove };
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
  async function create(input: Omit<VideoRecord, "id" | "created_at" | "updated_at" | "views" | "categories">) {
    try { const { data, error } = await createClient().from("videos").insert(input).select("*, categories(name)").single(); if (error) throw error; setVideos((old) => [data as VideoRecord, ...old]); toast.success("Video added."); return true; }
    catch { toast.error("Could not add video. Check the URL and category."); return false; }
  }
  async function update(id: string, input: Partial<Omit<VideoRecord, "id" | "created_at" | "updated_at" | "categories">>) {
    try { const { data, error } = await createClient().from("videos").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id).select("*, categories(name)").single(); if (error) throw error; setVideos((old) => old.map((item) => item.id === id ? data as VideoRecord : item)); toast.success("Video updated."); return true; }
    catch { toast.error("Could not update video."); return false; }
  }
  async function remove(id: string) {
    try { const { error } = await createClient().from("videos").delete().eq("id", id); if (error) throw error; setVideos((old) => old.filter((item) => item.id !== id)); toast.success("Video deleted."); }
    catch { toast.error("Could not delete video."); }
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
