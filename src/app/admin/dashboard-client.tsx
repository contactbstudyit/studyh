"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Film, FolderOpen, LayoutDashboard, LogOut, Plus, Search, Settings, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Category, useCategories, useCategoryOptions, useLibraryStats, useVideos, VideoRecord } from "@/hooks/use-library";
import { createClient } from "@/lib/supabase/client";
import { generateVideoThumbnail } from "@/lib/video-thumbnail";

export default function AdminDashboard() {
  const router = useRouter();
  const [section, setSection] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [publishedFilter, setPublishedFilter] = useState("all");
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [quickCategory, setQuickCategory] = useState(false);
  const [categoryFormError, setCategoryFormError] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [thumbnailGeneration, setThumbnailGeneration] = useState<"idle" | "generating" | "generated" | "failed">("idle");
  const [thumbnailGenerationError, setThumbnailGenerationError] = useState("");
  const [editingVideo, setEditingVideo] = useState<VideoRecord | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const statsHook = useLibraryStats();
  const stats = statsHook.stats;
  const categoriesHook = useCategories();
  const categoryOptionsHook = useCategoryOptions();
  const searchCategoryIds = categoriesHook.categories.filter((category) => category.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((category) => category.id);
  const videosHook = useVideos({ admin: true, search, searchCategoryIds, categoryId: categoryFilter || undefined, published: publishedFilter === "all" ? undefined : publishedFilter === "published" });

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
    setThumbnailGeneration("idle");
    setThumbnailGenerationError("");
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
    let savedVideoId: string | null = null;
    if (editingVideo) {
      const ok = await videosHook.update(editingVideo.id, data);
      if (ok) savedVideoId = editingVideo.id;
    } else {
      const created = await videosHook.create(data);
      if (created) savedVideoId = created.id;
    }
    if (!savedVideoId) return;

    if (!thumbnail) {
      setThumbnailGeneration("generating");
      setThumbnailGenerationError("");
      try {
        const image = await generateVideoThumbnail(url, data.duration);
        const response = await fetch(`/api/admin/videos/${encodeURIComponent(savedVideoId)}/thumbnail`, { method: "POST", headers: { "Content-Type": image.type }, body: image });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || "Thumbnail storage request failed");
        setThumbnailGeneration("generated");
        toast.success("Thumbnail generated");
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown thumbnail error";
        setThumbnailGeneration("failed");
        setThumbnailGenerationError(reason);
        toast.error("Thumbnail could not be generated. You can add a thumbnail URL manually.");
        if (process.env.NODE_ENV === "development") console.error("[video-thumbnail] generation failed; video remains saved", { videoId: savedVideoId, sourceHost: new URL(url).host, reason });
      }
    }
    setEditingVideo(null); setSection("Videos"); await videosHook.refresh(); await categoriesHook.refresh(); await statsHook.refresh();
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
  async function toggleVideo(video: VideoRecord, field: "published" | "featured") { await videosHook.update(video.id, { [field]: !video[field] }); await statsHook.refresh(); }
  async function deleteCategory(category: Category) {
    if (!window.confirm(`Delete “${category.name}”? Categories with videos cannot be deleted.`)) return;
    await categoriesHook.remove(category.id); await categoryOptionsHook.refresh(); await statsHook.refresh();
  }

  const nav = [{ name: "Dashboard", icon: LayoutDashboard }, { name: "Videos", icon: Film }, { name: "Add Video", icon: Plus }, { name: "Categories", icon: FolderOpen }, { name: "Settings", icon: Settings }];
  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><a href="/" className="dash-back"><ArrowLeft size={15}/> Public library</a><div className="dash-kicker"><ShieldCheck size={15}/> ADMIN</div><nav>{nav.map(({ name, icon: Icon }) => <button key={name} className={section === name ? "dash-nav active" : "dash-nav"} onClick={() => name === "Add Video" ? openVideo() : setSection(name)}><Icon size={16}/>{name}</button>)}</nav><button className="dash-logout" onClick={logout}><LogOut size={15}/> Sign out</button></aside>
    <section className="dashboard-content"><header className="dashboard-top"><span>LIBRARY MANAGEMENT</span><button onClick={logout}><LogOut size={14}/> Sign out</button></header>
      {section === "Dashboard" && <><div className="admin-heading"><div><span className="eyebrow">OVERVIEW</span><h1>Dashboard</h1><p>Your library at a glance.</p></div><button className="button-primary" onClick={() => openVideo()}><Plus size={15}/> Add video</button></div><div className="stats-row"><Stat label="Total videos" value={stats?.total_videos}/><Stat label="Published" value={stats?.published_videos}/><Stat label="Categories" value={stats?.total_categories}/><Stat label="Total views" value={stats?.total_views}/></div><div className="table-heading"><h2>Recently added</h2><button onClick={() => setSection("Videos")}>Manage videos <ArrowLeft size={13}/></button></div><VideoTable videos={videosHook.videos.slice(0, 6)} categories={categoriesHook.categories} onEdit={openVideo} onDelete={removeVideo} onToggle={toggleVideo}/></>}
      {section === "Videos" && <><div className="admin-heading"><div><span className="eyebrow">LIBRARY</span><h1>Videos</h1><p>Search, update, and publish your collection.</p></div><button className="button-primary" onClick={() => openVideo()}><Plus size={15}/> Add video</button></div><div className="table-tools"><label><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search videos"/></label><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categoriesHook.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><select value={publishedFilter} onChange={(event) => setPublishedFilter(event.target.value)}><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Unpublished</option></select></div><VideoTable videos={videosHook.videos} categories={categoriesHook.categories} onEdit={openVideo} onDelete={removeVideo} onToggle={toggleVideo}/>{videosHook.hasMore && <button className="load-admin" onClick={videosHook.loadMore}>Load more</button>}</>}
      {section === "Add Video" && <><div className="admin-heading add-video-heading"><div><span className="eyebrow">LIBRARY</span><h1>{editingVideo ? "Edit video" : "Add video"}</h1><p>Videos stream directly from their external URLs.</p></div></div><div className="video-editor-card"><form key={editingVideo?.id ?? "new-video"} onSubmit={submitVideo}><label>VIDEO URL<input name="video_url" type="url" required placeholder="https://cdn.example.com/video.mp4" defaultValue={editingVideo?.video_url}/><small>External HTTPS URL only. No video upload.</small></label><label>TITLE<input name="title" required maxLength={180} defaultValue={editingVideo?.title}/></label><div className="category-field"><label htmlFor="video-category">CATEGORY</label><div className="category-control-row"><select id="video-category" name="category_id" required value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)} disabled={categoryOptionsHook.loading || (Boolean(categoryOptionsHook.error) && categoryOptionsHook.categories.length === 0)}><option value="" disabled>{categoryOptionsHook.loading ? "Loading categories..." : categoryOptionsHook.error ? "Categories unavailable" : categoryOptionsHook.categories.length ? "Select category" : "No categories yet — Create category"}</option>{categoryOptionsHook.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><button className="create-category-inline" type="button" onClick={() => openCategory(undefined, true)}><Plus size={14}/> Create category</button></div>{categoryOptionsHook.error && <p className="field-error" role="alert">Could not load categories: {categoryOptionsHook.error} <button type="button" onClick={() => void categoryOptionsHook.refresh()}>Retry</button></p>}{!categoryOptionsHook.error && !categoryOptionsHook.loading && categoryOptionsHook.categories.length === 0 && <p className="field-empty">No categories yet — Create category</p>}</div><label>DESCRIPTION<textarea name="description" rows={3} defaultValue={editingVideo?.description}/></label><label>THUMBNAIL URL<input name="thumbnail_url" type="url" placeholder="https://..." defaultValue={editingVideo?.thumbnail_url ?? ""}/><small>Optional — leave empty to automatically generate a thumbnail from the video.</small></label>{thumbnailGeneration === "generating" && <p className="thumbnail-status" role="status">Generating thumbnail…</p>}{thumbnailGeneration === "generated" && <p className="thumbnail-status success" role="status">Thumbnail generated</p>}{thumbnailGeneration === "failed" && <p className="thumbnail-status warning" role="status">Thumbnail could not be generated. You can add a thumbnail URL manually.{thumbnailGenerationError && <span className="thumbnail-error-detail"> {thumbnailGenerationError}</span>}</p>}<label>TAGS<input name="tags" placeholder="documentary, travel" defaultValue={editingVideo?.tags.join(", ")}/></label><label>DURATION<input name="duration" placeholder="12:34" defaultValue={editingVideo?.duration}/></label><div className="check-row"><label><input type="checkbox" name="featured" defaultChecked={editingVideo?.featured}/> Featured</label><label><input type="checkbox" name="published" defaultChecked={editingVideo?.published ?? true}/> Published</label></div><div className="video-form-actions"><button className="button-primary submit-button" type="submit" disabled={categoryOptionsHook.loading || (Boolean(categoryOptionsHook.error) && categoryOptionsHook.categories.length === 0) || categoriesHook.loading || thumbnailGeneration === "generating"}>{editingVideo ? "Save changes" : "Add video"}</button><button className="cancel-video-button" type="button" onClick={() => { setEditingVideo(null); setSection("Videos"); }}>Cancel</button></div></form></div></>}
      {section === "Categories" && <><div className="admin-heading"><div><span className="eyebrow">ORGANIZE</span><h1>Categories</h1><p>Create and manage library categories.</p></div><button className="button-primary" onClick={() => openCategory()}><Plus size={15}/> Add category</button></div><div className="category-admin-list">{categoriesHook.categories.map((category) => <div className="category-admin-row" key={category.id}><div><strong>{category.name}</strong><span>{category.description || "No description"}</span></div><span>{category.video_count ?? 0} videos</span><button onClick={() => openCategory(category)}>Edit</button><button aria-label={`Delete ${category.name}`} onClick={() => deleteCategory(category)}><Trash2 size={15}/></button></div>)}{categoriesHook.categories.length === 0 && <p className="admin-empty">No categories yet. Create one to organize videos.</p>}</div></>}
      {section === "Settings" && <><div className="admin-heading"><div><span className="eyebrow">ACCOUNT</span><h1>Settings</h1><p>Manage your admin session.</p></div></div><div className="settings-panel"><ShieldCheck size={18}/><div><strong>Protected with Supabase Auth</strong><span>Admin actions are enforced by database row-level security policies.</span></div><button onClick={logout}>Sign out</button></div><p className="admin-note">Video files are never uploaded. Playback streams directly from each external URL.</p></>}
    </section>
    {categoryDialog && <div className="modal-backdrop category-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCategoryDialog(false); }}><section className="add-modal category-modal" role="dialog" aria-modal="true" aria-labelledby="category-modal-title"><div className="modal-title"><div><span className="eyebrow">CATEGORY MANAGEMENT</span><h2 id="category-modal-title">{quickCategory ? "Create category" : editingCategory ? "Edit category" : "Create category"}</h2></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setCategoryDialog(false)}><X size={18}/></button></div><form onSubmit={submitCategory}><label>Name<input name="name" required maxLength={80} autoFocus defaultValue={editingCategory?.name}/></label><label>Description (optional)<textarea name="description" rows={3} defaultValue={editingCategory?.description}/></label>{!quickCategory && <label>Image URL<input name="image_url" type="url" defaultValue={editingCategory?.image_url ?? ""}/></label>}{categoryFormError && <p className="field-error" role="alert">{categoryFormError}</p>}<div className="category-modal-actions"><button className="cancel-video-button" type="button" onClick={() => setCategoryDialog(false)}>Cancel</button><button className="button-primary" type="submit">{editingCategory ? "Save changes" : "Create category"}</button></div></form></section></div>}
  </main>;
}

function Stat({ label, value }: { label: string; value?: number }) { return <div className="stat-card"><span>{label}</span><strong>{value?.toLocaleString() ?? "—"}</strong><small>From your library</small></div>; }
function VideoTable({ videos, categories, onEdit, onDelete, onToggle }: { videos: VideoRecord[]; categories: Category[]; onEdit: (video: VideoRecord) => void; onDelete: (id: string) => void; onToggle: (video: VideoRecord, field: "published" | "featured") => void }) {
  return <div className="admin-table video-management-table"><div className="video-table-head"><span>VIDEO</span><span>CATEGORY</span><span>STATUS</span><span>VIEWS</span><span>ADDED</span><span>ACTIONS</span></div>{videos.map((video) => <div className="admin-row video-table-row" key={video.id}><img src={video.thumbnail_url || "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=180&q=75"} alt=""/><div className="admin-title"><strong>{video.title}</strong><span>{video.featured ? "Featured · " : ""}{video.duration || "Video"}</span></div><span>{video.categories?.name ?? categories.find((item) => item.id === video.category_id)?.name ?? "—"}</span><span>{video.published ? "Published" : "Draft"}</span><span>{video.views.toLocaleString()}</span><span>{new Date(video.created_at).toLocaleDateString()}</span><div className="row-actions"><button onClick={() => onEdit(video)}>Edit</button><button onClick={() => onToggle(video, "published")}>{video.published ? "Unpublish" : "Publish"}</button><button onClick={() => onToggle(video, "featured")}>{video.featured ? "Unfeature" : "Feature"}</button><button onClick={() => { if (window.confirm(`Delete “${video.title}”? This cannot be undone.`)) void onDelete(video.id); }} aria-label={`Delete ${video.title}`}><Trash2 size={14}/></button></div></div>)}{videos.length === 0 && <p className="admin-empty">No videos found.</p>}</div>;
}
