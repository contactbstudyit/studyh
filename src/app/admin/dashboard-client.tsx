"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Film, FolderOpen, LayoutDashboard, LogOut, Plus, Search, Settings, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Category, useCategories, useCategoryOptions, useLibraryStats, useVideos, VideoRecord } from "@/hooks/use-library";
import { createClient } from "@/lib/supabase/client";
import { generateVideoThumbnail, isGeneratedThumbnailUrl } from "@/lib/video-thumbnail";
import { getCategorySlug } from "@/lib/category-slug";
import VideoPagination from "@/components/video-pagination";

const ADMIN_VIDEO_PAGE_SIZE = 15;
const showDashboardStatsDiagnostics = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

export default function AdminDashboard() {
  const router = useRouter();
  const [section, setSection] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [publishedFilter, setPublishedFilter] = useState("all");
  const [videoPage, setVideoPage] = useState(1);
  const [adminFiltersReady, setAdminFiltersReady] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [quickCategory, setQuickCategory] = useState(false);
  const [categoryFormError, setCategoryFormError] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [videoSubmitInProgress, setVideoSubmitInProgress] = useState(false);
  const videoSubmitLock = useRef(false);
  const [generatingThumbnailIds, setGeneratingThumbnailIds] = useState<Set<string>>(() => new Set());
  const [thumbnailBatchRunning, setThumbnailBatchRunning] = useState(false);
  const [thumbnailBatchProgress, setThumbnailBatchProgress] = useState("");
  const [editingVideo, setEditingVideo] = useState<VideoRecord | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const statsHook = useLibraryStats();
  const stats = statsHook.stats;
  const categoriesHook = useCategories();
  const categoryOptionsHook = useCategoryOptions();
  const searchCategoryIds = categoriesHook.categories.filter((category) => category.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((category) => category.id);
  const isVideoSection = section === "Videos";
  const videosHook = useVideos({ admin: true, search, searchCategoryIds, categoryId: categoryFilter || undefined, published: publishedFilter === "all" ? undefined : publishedFilter === "published", pageNumber: isVideoSection && adminFiltersReady ? videoPage : undefined, pageSize: isVideoSection ? ADMIN_VIDEO_PAGE_SIZE : undefined });

  useEffect(() => {
    if (categoriesHook.loading || adminFiltersReady) return;
    const applyUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const urlSection = params.get("section");
      if (urlSection === "videos") setSection("Videos");
      else if (urlSection === "categories") setSection("Categories");
      else if (urlSection === "settings") setSection("Settings");
      const searchValue = params.get("search") ?? "";
      setSearch(searchValue);
      const urlCategory = params.get("category");
      const matched = urlCategory ? categoriesHook.categories.find((item) => getCategorySlug(item, categoriesHook.categories) === urlCategory || item.id === urlCategory) : null;
      setCategoryFilter(matched?.id ?? "");
      const urlStatus = params.get("status");
      setPublishedFilter(urlStatus === "published" || urlStatus === "draft" ? urlStatus : "all");
      const requestedPage = Number.parseInt(params.get("page") ?? "1", 10);
      setVideoPage(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    };
    applyUrl(); setAdminFiltersReady(true);
  }, [categoriesHook.loading, categoriesHook.categories, adminFiltersReady]);

  useEffect(() => {
    if (!adminFiltersReady) return;
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("section") === "videos") setSection("Videos");
      else if (params.get("section") === "categories") setSection("Categories");
      else if (params.get("section") === "settings") setSection("Settings");
      else setSection("Dashboard");
      setSearch(params.get("search") ?? "");
      const urlCategory = params.get("category");
      const matched = urlCategory ? categoriesHook.categories.find((item) => getCategorySlug(item, categoriesHook.categories) === urlCategory || item.id === urlCategory) : null;
      setCategoryFilter(matched?.id ?? "");
      const status = params.get("status"); setPublishedFilter(status === "published" || status === "draft" ? status : "all");
      const page = Number.parseInt(params.get("page") ?? "1", 10); setVideoPage(Number.isFinite(page) && page > 0 ? page : 1);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [adminFiltersReady, categoriesHook.categories]);

  function writeVideosUrl(nextPage: number, nextSearch = search, nextCategory = categoryFilter, nextStatus = publishedFilter, replace = true) {
    const url = new URL(window.location.href);
    url.searchParams.set("section", "videos");
    if (nextPage > 1) url.searchParams.set("page", String(nextPage)); else url.searchParams.delete("page");
    if (nextSearch.trim()) url.searchParams.set("search", nextSearch.trim()); else url.searchParams.delete("search");
    if (nextCategory) {
      const category = categoriesHook.categories.find((item) => item.id === nextCategory);
      url.searchParams.set("category", category ? getCategorySlug(category, categoriesHook.categories) : nextCategory);
    } else url.searchParams.delete("category");
    if (nextStatus !== "all") url.searchParams.set("status", nextStatus); else url.searchParams.delete("status");
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  }

  function goToVideos(page = 1, replace = false) {
    setSection("Videos"); setVideoPage(page);
    writeVideosUrl(page, search, categoryFilter, publishedFilter, replace);
  }

  function changeVideoSearch(value: string) {
    setSearch(value); setVideoPage(1);
    writeVideosUrl(1, value, categoryFilter, publishedFilter, true);
  }

  function changeVideoCategory(value: string) {
    setCategoryFilter(value); setVideoPage(1);
    writeVideosUrl(1, search, value, publishedFilter, true);
  }

  function changeVideoStatus(value: string) {
    setPublishedFilter(value); setVideoPage(1);
    writeVideosUrl(1, search, categoryFilter, value, true);
  }

  function navigateSection(name: string) {
    if (name === "Add Video") { openVideo(); return; }
    setSection(name);
    const url = new URL(window.location.href);
    if (name === "Dashboard") url.searchParams.delete("section"); else url.searchParams.set("section", name.toLowerCase());
    url.searchParams.delete("page");
    window.history.pushState(null, "", url);
  }

  const adminTotalPages = Math.ceil((videosHook.totalCount ?? 0) / ADMIN_VIDEO_PAGE_SIZE);
  useEffect(() => {
    if (!adminFiltersReady || section !== "Videos" || videosHook.totalCount === null) return;
    const lastPage = Math.max(1, adminTotalPages);
    if (videoPage > lastPage) goToVideos(lastPage, true);
  }, [adminFiltersReady, section, videosHook.totalCount, adminTotalPages, videoPage]);

  useEffect(() => {
    if (process.env.NODE_ENV === "development" && section === "Add Video") {
      console.info("[admin-category-options] Add Video dropdown render", {
        categoryCount: categoryOptionsHook.categories.length,
        categoryIds: categoryOptionsHook.categories.map((category) => category.id),
        selectedCategoryId,
        loading: categoryOptionsHook.loading,
        error: categoryOptionsHook.error || null,
      });
    }
  }, [section, categoryOptionsHook.categories, categoryOptionsHook.loading, categoryOptionsHook.error, selectedCategoryId]);

  useEffect(() => {
    if (!categoryDialog) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setCategoryDialog(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [categoryDialog]);

  async function logout() { await createClient().auth.signOut(); router.replace("/admin/login"); router.refresh(); }
  function openVideo(video?: VideoRecord) {
    setEditingVideo(video ?? null);
    setSelectedCategoryId(video?.category_id ?? "");
    setSection("Add Video");
    categoriesHook.setErrorMessage("");
    void categoryOptionsHook.refresh();
  }
  function openCategory(category?: Category, quick = false) { setEditingCategory(category ?? null); setQuickCategory(quick); setCategoryFormError(""); setCategoryDialog(true); }

  async function submitVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const url = String(form.get("video_url") ?? "");
    const validHttps = (value: string) => { try { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password; } catch { return false; } };
    if (!validHttps(url)) { toast.error("Enter a valid HTTPS video URL."); return; }
    const thumbnail = String(form.get("thumbnail_url") ?? "").trim();
    if (thumbnail && !validHttps(thumbnail)) { toast.error("Thumbnail URL must use HTTPS."); return; }
    const tags = String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const title = String(form.get("title") ?? "").trim();
    if (!title || title.length > 180 || tags.length > 30) { toast.error("Check the title and use no more than 30 tags."); return; }
    const categoryId = String(form.get("category_id") ?? "");
    if (!categoryId) { toast.error("Choose a category before saving the video."); return; }
    const data = { title, video_url: url, description: String(form.get("description") ?? "").trim(), thumbnail_url: thumbnail || null, category_id: categoryId, tags, duration: String(form.get("duration") ?? "").trim(), featured: form.get("featured") === "on", published: form.get("published") === "on" };
    if (videoSubmitLock.current) return;
    videoSubmitLock.current = true; setVideoSubmitInProgress(true);
    const formElement = event.currentTarget;
    let savedVideo: VideoRecord | null = null;
    try {
      if (editingVideo) {
        const updated = await videosHook.update(editingVideo.id, data);
        if (updated) savedVideo = { ...editingVideo, ...data, updated_at: new Date().toISOString() };
      } else savedVideo = await videosHook.create(data);
    } finally { videoSubmitLock.current = false; setVideoSubmitInProgress(false); }

    if (!savedVideo) return;
    formElement.reset();
    setSelectedCategoryId("");
    setEditingVideo(null);
    goToVideos(1, true);
    if (!editingVideo) toast.success("Video added successfully");
    void videosHook.refresh();
    void categoriesHook.refresh();
    void statsHook.refresh();
    if (!thumbnail) void generateThumbnailFor(savedVideo);
  }
  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setCategoryFormError("");
    const imageUrl = quickCategory ? "" : String(form.get("image_url") ?? "").trim();
    if (imageUrl) { try { if (new URL(imageUrl).protocol !== "https:") throw new Error(); } catch { toast.error("Category image URL must use HTTPS."); return; } }
    const name = String(form.get("name") ?? "").trim();
    if (!name || name.length > 80) { toast.error("Category name must be between 1 and 80 characters."); return; }
    const data = { name, description: String(form.get("description") ?? "").trim(), image_url: imageUrl || null };
    let category: Category | null = null;
    if (editingCategory) {
      const ok = await categoriesHook.update(editingCategory.id, data);
      if (!ok) { setCategoryFormError(categoriesHook.errorMessage || "Could not update category."); return; }
      category = { ...editingCategory, ...data, updated_at: new Date().toISOString() };
    } else {
      const result = await categoriesHook.create(data);
      if (!result.category) { setCategoryFormError(result.error || "Could not create category."); return; }
      category = result.category;
    }
    setCategoryDialog(false); setEditingCategory(null); await statsHook.refresh();
    if (quickCategory && category) {
      categoryOptionsHook.add(category);
      setSelectedCategoryId(category.id);
      await categoryOptionsHook.refresh();
    } else await categoryOptionsHook.refresh();
  }
  async function removeVideo(id: string) {
    try {
      const response = await fetch(`/api/admin/videos/${encodeURIComponent(id)}/thumbnail`, { method: "DELETE" });
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || "Could not clean up the generated thumbnail"); }
      const removed = await videosHook.remove(id);
      if (removed) { await statsHook.refresh(); await categoriesHook.refresh(); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete video and thumbnail."); }
  }
  async function generateThumbnailFor(video: Pick<VideoRecord, "id" | "title" | "video_url" | "duration" | "thumbnail_url">) {
    if (generatingThumbnailIds.has(video.id)) return false;
    if (video.thumbnail_url && !isGeneratedThumbnailUrl(video.id, video.thumbnail_url)) {
      toast.error(`The manually supplied thumbnail for ${video.title} is preserved. Clear its URL before generating a replacement.`);
      return false;
    }
    setGeneratingThumbnailIds((current) => new Set(current).add(video.id));
    try {
      const image = await generateVideoThumbnail(video.video_url, video.duration);
      const response = await fetch(`/api/admin/videos/${encodeURIComponent(video.id)}/thumbnail`, { method: "POST", headers: { "Content-Type": image.type }, body: image });
      const result = await response.json() as { thumbnail_url?: string; error?: string };
      if (!response.ok || !result.thumbnail_url) throw new Error(result.error || "Thumbnail upload failed");
      await videosHook.refresh();
      toast.success(`Thumbnail generated: ${video.title}`);
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown thumbnail error";
      if (process.env.NODE_ENV === "development") console.error("[video-thumbnail] regeneration failed", { videoId: video.id, sourceHost: (() => { try { return new URL(video.video_url).host; } catch { return "invalid URL"; } })(), detail });
      toast.error(`Thumbnail could not be generated for ${video.title}: ${detail}`);
      return false;
    } finally {
      setGeneratingThumbnailIds((current) => { const next = new Set(current); next.delete(video.id); return next; });
    }
  }
  async function generateMissingThumbnails() {
    if (thumbnailBatchRunning) return;
    const missing = await videosHook.getMissingThumbnails();
    if (!missing) return;
    if (!missing.length) { toast.success("All videos already have thumbnails."); return; }
    setThumbnailBatchRunning(true);
    let generated = 0;
    try {
      for (let index = 0; index < missing.length; index++) {
        const video = missing[index];
        setThumbnailBatchProgress(`Generating ${index + 1} of ${missing.length}: ${video.title}`);
        if (await generateThumbnailFor(video)) generated++;
      }
      toast.success(`Generated ${generated} of ${missing.length} missing thumbnails.`);
    } finally { setThumbnailBatchRunning(false); setThumbnailBatchProgress(""); }
  }
  async function toggleVideo(video: VideoRecord, field: "published" | "featured") { await videosHook.update(video.id, { [field]: !video[field] }); await statsHook.refresh(); }
  async function deleteCategory(category: Category) {
    if (!window.confirm(`Delete “${category.name}”? Categories with videos cannot be deleted.`)) return;
    await categoriesHook.remove(category.id); await categoryOptionsHook.refresh(); await statsHook.refresh();
  }

  const nav = [{ name: "Dashboard", icon: LayoutDashboard }, { name: "Videos", icon: Film }, { name: "Add Video", icon: Plus }, { name: "Categories", icon: FolderOpen }, { name: "Settings", icon: Settings }];
  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><a href="/" className="dash-back"><ArrowLeft size={15}/> Public library</a><div className="dash-kicker"><ShieldCheck size={15}/> ADMIN</div><nav>{nav.map(({ name, icon: Icon }) => <button key={name} className={section === name ? "dash-nav active" : "dash-nav"} onClick={() => navigateSection(name)}><Icon size={16}/>{name}</button>)}</nav><button className="dash-logout" onClick={logout}><LogOut size={15}/> Sign out</button></aside>
    <section className="dashboard-content"><header className="dashboard-top"><span>LIBRARY MANAGEMENT</span><button onClick={logout}><LogOut size={14}/> Sign out</button></header>
       {section === "Dashboard" && <><div className="admin-heading"><div><span className="eyebrow">OVERVIEW</span><h1>Dashboard</h1><p>Your library at a glance.</p></div><button className="button-primary" onClick={() => openVideo()}><Plus size={15}/> Add video</button></div><div className="stats-row"><Stat label="Total videos" value={stats?.total_videos}/><Stat label="Published" value={stats?.published_videos}/><Stat label="Categories" value={stats?.total_categories}/><Stat label="Total views" value={stats?.total_views}/></div>{showDashboardStatsDiagnostics && statsHook.diagnostic && <section className="dashboard-diagnostic" role="alert" aria-live="assertive"><h2>Dashboard statistics failed</h2><p>phase: {statsHook.diagnostic.phase}</p><p>message: {statsHook.diagnostic.message}</p><p>code: {statsHook.diagnostic.code ?? "(none)"}</p><p>details: {statsHook.diagnostic.details ?? "(none)"}</p><p>hint: {statsHook.diagnostic.hint ?? "(none)"}</p></section>}<div className="table-heading"><h2>Recently added</h2><button onClick={() => goToVideos()}>Manage videos <ArrowLeft size={13}/></button></div><VideoTable videos={videosHook.videos.slice(0, 6)} categories={categoriesHook.categories} onEdit={openVideo} onDelete={removeVideo} onToggle={toggleVideo} onGenerateThumbnail={generateThumbnailFor} generatingThumbnailIds={generatingThumbnailIds}/></>}
      {section === "Videos" && <><div className="admin-heading"><div><span className="eyebrow">LIBRARY</span><h1>Videos</h1><p>Search, update, and publish your collection.</p></div><div className="video-header-actions"><button className="secondary-action" onClick={generateMissingThumbnails} disabled={thumbnailBatchRunning}>{thumbnailBatchRunning ? "Generating thumbnails..." : "Generate Missing Thumbnails"}</button><button className="button-primary" onClick={() => openVideo()}><Plus size={15}/> Add video</button></div></div>{thumbnailBatchProgress && <p className="thumbnail-status" role="status">{thumbnailBatchProgress}</p>}<div className="table-tools"><label><Search size={15}/><input value={search} onChange={(event) => changeVideoSearch(event.target.value)} placeholder="Search videos"/></label><select value={categoryFilter} onChange={(event) => changeVideoCategory(event.target.value)}><option value="">All categories</option>{categoriesHook.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><select value={publishedFilter} onChange={(event) => changeVideoStatus(event.target.value)}><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Unpublished</option></select></div><VideoTable videos={videosHook.videos} categories={categoriesHook.categories} onEdit={openVideo} onDelete={removeVideo} onToggle={toggleVideo} onGenerateThumbnail={generateThumbnailFor} generatingThumbnailIds={generatingThumbnailIds}/><VideoPagination page={videoPage} totalPages={adminTotalPages} loading={videosHook.loading} onPageChange={(page) => goToVideos(page, false)} hideNextOnLast/></>}
      {section === "Add Video" && <><div className="admin-heading add-video-heading"><div><span className="eyebrow">LIBRARY</span><h1>{editingVideo ? "Edit video" : "Add video"}</h1><p>Videos stream directly from their external URLs.</p></div></div><div className="video-editor-card"><form key={editingVideo?.id ?? "new-video"} onSubmit={submitVideo}><label>VIDEO URL<input name="video_url" type="url" required placeholder="https://cdn.example.com/video.mp4" defaultValue={editingVideo?.video_url}/><small>External HTTPS URL only. No video upload.</small></label><label>TITLE<input name="title" required maxLength={180} defaultValue={editingVideo?.title}/></label><div className="category-field"><label htmlFor="video-category">CATEGORY</label><div className="category-control-row"><select id="video-category" name="category_id" required value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)} disabled={categoryOptionsHook.loading || (Boolean(categoryOptionsHook.error) && categoryOptionsHook.categories.length === 0)}><option value="" disabled>{categoryOptionsHook.loading ? "Loading categories..." : categoryOptionsHook.error ? "Categories unavailable" : categoryOptionsHook.categories.length ? "Select category" : "No categories yet — Create category"}</option>{categoryOptionsHook.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><button className="create-category-inline" type="button" onClick={() => openCategory(undefined, true)}><Plus size={14}/> Create category</button></div>{categoryOptionsHook.error && <p className="field-error" role="alert">Could not load categories: {categoryOptionsHook.error} <button type="button" onClick={() => void categoryOptionsHook.refresh()}>Retry</button></p>}{!categoryOptionsHook.error && !categoryOptionsHook.loading && categoryOptionsHook.categories.length === 0 && <p className="field-empty">No categories yet — Create category</p>}</div><label>DESCRIPTION<textarea name="description" rows={3} defaultValue={editingVideo?.description}/></label><label>THUMBNAIL URL<input name="thumbnail_url" type="url" placeholder="https://..." defaultValue={editingVideo?.thumbnail_url ?? ""}/><small>Optional — leave empty to automatically generate a thumbnail from the video.</small></label><label>TAGS<input name="tags" placeholder="documentary, travel" defaultValue={editingVideo?.tags.join(", ")}/></label><label>DURATION<input name="duration" placeholder="12:34" defaultValue={editingVideo?.duration}/></label><div className="check-row"><label><input type="checkbox" name="featured" defaultChecked={editingVideo?.featured}/> Featured</label><label><input type="checkbox" name="published" defaultChecked={editingVideo?.published ?? true}/> Published</label></div><div className="video-form-actions"><button className="button-primary submit-button" type="submit" disabled={videoSubmitInProgress}>{videoSubmitInProgress ? "Saving..." : editingVideo ? "Save changes" : "Add video"}</button><button className="cancel-video-button" type="button" onClick={() => { setEditingVideo(null); setSection("Videos"); }}>Cancel</button></div></form></div></>}
      {section === "Categories" && <><div className="admin-heading"><div><span className="eyebrow">ORGANIZE</span><h1>Categories</h1><p>Create and manage library categories.</p></div><button className="button-primary" onClick={() => openCategory()}><Plus size={15}/> Add category</button></div><div className="category-admin-list">{categoriesHook.categories.map((category) => <div className="category-admin-row" key={category.id}><div><strong>{category.name}</strong><span>{category.description || "No description"}</span></div><span>{category.video_count ?? 0} videos</span><button onClick={() => openCategory(category)}>Edit</button><button aria-label={`Delete ${category.name}`} onClick={() => deleteCategory(category)}><Trash2 size={15}/></button></div>)}{categoriesHook.categories.length === 0 && <p className="admin-empty">No categories yet. Create one to organize videos.</p>}</div></>}
       {section === "Settings" && <><div className="admin-heading"><div><span className="eyebrow">ACCOUNT</span><h1>Settings</h1><p>Manage your admin session.</p></div></div><div className="settings-panel"><ShieldCheck size={18}/><div><strong>Authenticator app MFA</strong><span>A verified TOTP factor and AAL2 session are required for admin access.</span></div><button onClick={logout}>Sign out</button></div><p className="admin-note">Video files are never uploaded. Playback streams directly from each external URL.</p></>}
    </section>
    {categoryDialog && <div className="modal-backdrop category-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCategoryDialog(false); }}><section className="add-modal category-modal" role="dialog" aria-modal="true" aria-labelledby="category-modal-title"><div className="modal-title"><div><span className="eyebrow">CATEGORY MANAGEMENT</span><h2 id="category-modal-title">{quickCategory ? "Create category" : editingCategory ? "Edit category" : "Create category"}</h2></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setCategoryDialog(false)}><X size={18}/></button></div><form onSubmit={submitCategory}><label>Name<input name="name" required maxLength={80} autoFocus defaultValue={editingCategory?.name}/></label><label>Description (optional)<textarea name="description" rows={3} defaultValue={editingCategory?.description}/></label>{!quickCategory && <label>Image URL<input name="image_url" type="url" defaultValue={editingCategory?.image_url ?? ""}/></label>}{categoryFormError && <p className="field-error" role="alert">{categoryFormError}</p>}<div className="category-modal-actions"><button className="cancel-video-button" type="button" onClick={() => setCategoryDialog(false)}>Cancel</button><button className="button-primary" type="submit">{editingCategory ? "Save changes" : "Create category"}</button></div></form></section></div>}
  </main>;
}

function Stat({ label, value }: { label: string; value?: number }) { return <div className="stat-card"><span>{label}</span><strong>{value?.toLocaleString() ?? "—"}</strong><small>From your library</small></div>; }
function VideoTable({ videos, categories, onEdit, onDelete, onToggle, onGenerateThumbnail, generatingThumbnailIds }: { videos: VideoRecord[]; categories: Category[]; onEdit: (video: VideoRecord) => void; onDelete: (id: string) => void; onToggle: (video: VideoRecord, field: "published" | "featured") => void; onGenerateThumbnail: (video: VideoRecord) => Promise<boolean>; generatingThumbnailIds: Set<string> }) {
  return <div className="admin-table video-management-table"><div className="video-table-head"><span>VIDEO</span><span>CATEGORY</span><span>STATUS</span><span>VIEWS</span><span>ADDED</span><span>ACTIONS</span></div>{videos.map((video) => { const isGenerated = isGeneratedThumbnailUrl(video.id, video.thumbnail_url); return <div className="admin-row video-table-row" key={video.id}><img src={video.thumbnail_url || "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=180&q=75"} alt=""/><div className="admin-title"><strong>{video.title}</strong><span>{video.featured ? "Featured · " : ""}{video.duration || "Video"}</span></div><span>{video.categories?.name ?? categories.find((item) => item.id === video.category_id)?.name ?? "—"}</span><span>{video.published ? "Published" : "Draft"}</span><span>{video.views.toLocaleString()}</span><span>{new Date(video.created_at).toLocaleDateString()}</span><div className="row-actions"><button onClick={() => onEdit(video)}>Edit</button>{!video.thumbnail_url || isGenerated ? <button onClick={() => void onGenerateThumbnail(video)} disabled={generatingThumbnailIds.has(video.id)}>{generatingThumbnailIds.has(video.id) ? "Generating…" : video.thumbnail_url ? "Regenerate thumbnail" : "Generate thumbnail"}</button> : <span className="manual-thumbnail-label" title="Manually supplied thumbnail URLs are preserved">Manual thumbnail</span>}<button onClick={() => onToggle(video, "published")}>{video.published ? "Unpublish" : "Publish"}</button><button onClick={() => onToggle(video, "featured")}>{video.featured ? "Unfeature" : "Feature"}</button><button onClick={() => { if (window.confirm(`Delete “${video.title}”? This cannot be undone.`)) void onDelete(video.id); }} aria-label={`Delete ${video.title}`}><Trash2 size={14}/></button></div></div>;})}{videos.length === 0 && <p className="admin-empty">No videos found.</p>}</div>;
}
