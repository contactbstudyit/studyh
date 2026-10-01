"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Film, FolderOpen, LayoutDashboard, LogOut, Plus, Search, Settings, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Category, useCategories, useLibraryStats, useVideos, VideoRecord } from "@/hooks/use-library";
import { createClient } from "@/lib/supabase/client";

export default function AdminDashboard() {
  const router = useRouter();
  const [section, setSection] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [publishedFilter, setPublishedFilter] = useState("all");
  const [videoDialog, setVideoDialog] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [editingVideo, setEditingVideo] = useState<VideoRecord | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const statsHook = useLibraryStats();
  const stats = statsHook.stats;
  const categoriesHook = useCategories();
  const searchCategoryIds = categoriesHook.categories.filter((category) => category.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((category) => category.id);
  const videosHook = useVideos({ admin: true, search, searchCategoryIds, categoryId: categoryFilter || undefined, published: publishedFilter === "all" ? undefined : publishedFilter === "published" });

  async function logout() { await createClient().auth.signOut(); router.replace("/admin/login"); router.refresh(); }
  function openVideo(video?: VideoRecord) { setEditingVideo(video ?? null); setVideoDialog(true); }
  function openCategory(category?: Category) { setEditingCategory(category ?? null); setCategoryDialog(true); }

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
    const data = { title, video_url: url, description: String(form.get("description") ?? "").trim(), thumbnail_url: thumbnail || null, category_id: String(form.get("category_id") ?? ""), tags, duration: String(form.get("duration") ?? "").trim(), featured: form.get("featured") === "on", published: form.get("published") === "on" };
    const ok = editingVideo ? await videosHook.update(editingVideo.id, data) : await videosHook.create(data);
    if (ok) { setVideoDialog(false); setEditingVideo(null); setSection("Videos"); await videosHook.refresh(); await categoriesHook.refresh(); await statsHook.refresh(); }
  }
  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const imageUrl = String(form.get("image_url") ?? "").trim();
    if (imageUrl) { try { if (new URL(imageUrl).protocol !== "https:") throw new Error(); } catch { toast.error("Category image URL must use HTTPS."); return; } }
    const name = String(form.get("name") ?? "").trim();
    if (!name || name.length > 80) { toast.error("Category name must be between 1 and 80 characters."); return; }
    const data = { name, description: String(form.get("description") ?? "").trim(), image_url: imageUrl || null };
    const ok = editingCategory ? await categoriesHook.update(editingCategory.id, data) : await categoriesHook.create(data);
    if (ok) { setCategoryDialog(false); setEditingCategory(null); await statsHook.refresh(); }
  }
  async function removeVideo(id: string) { await videosHook.remove(id); await statsHook.refresh(); await categoriesHook.refresh(); }
  async function toggleVideo(video: VideoRecord, field: "published" | "featured") { await videosHook.update(video.id, { [field]: !video[field] }); await statsHook.refresh(); }
  async function deleteCategory(category: Category) {
    if (!window.confirm(`Delete “${category.name}”? Categories with videos cannot be deleted.`)) return;
    await categoriesHook.remove(category.id);
  }

  const nav = [{ name: "Dashboard", icon: LayoutDashboard }, { name: "Videos", icon: Film }, { name: "Add Video", icon: Plus }, { name: "Categories", icon: FolderOpen }, { name: "Settings", icon: Settings }];
  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><a href="/" className="dash-back"><ArrowLeft size={15}/> Public library</a><div className="dash-kicker"><ShieldCheck size={15}/> ADMIN</div><nav>{nav.map(({ name, icon: Icon }) => <button key={name} className={section === name ? "dash-nav active" : "dash-nav"} onClick={() => name === "Add Video" ? openVideo() : setSection(name)}><Icon size={16}/>{name}</button>)}</nav><button className="dash-logout" onClick={logout}><LogOut size={15}/> Sign out</button></aside>
    <section className="dashboard-content"><header className="dashboard-top"><span>LIBRARY MANAGEMENT</span><button onClick={logout}><LogOut size={14}/> Sign out</button></header>
      {section === "Dashboard" && <><div className="admin-heading"><div><span className="eyebrow">OVERVIEW</span><h1>Dashboard</h1><p>Your library at a glance.</p></div><button className="button-primary" onClick={() => openVideo()}><Plus size={15}/> Add video</button></div><div className="stats-row"><Stat label="Total videos" value={stats?.total_videos}/><Stat label="Published" value={stats?.published_videos}/><Stat label="Categories" value={stats?.total_categories}/><Stat label="Total views" value={stats?.total_views}/></div><div className="table-heading"><h2>Recently added</h2><button onClick={() => setSection("Videos")}>Manage videos <ArrowLeft size={13}/></button></div><VideoTable videos={videosHook.videos.slice(0, 6)} categories={categoriesHook.categories} onEdit={openVideo} onDelete={removeVideo} onToggle={toggleVideo}/></>}
      {section === "Videos" && <><div className="admin-heading"><div><span className="eyebrow">LIBRARY</span><h1>Videos</h1><p>Search, update, and publish your collection.</p></div><button className="button-primary" onClick={() => openVideo()}><Plus size={15}/> Add video</button></div><div className="table-tools"><label><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search videos"/></label><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categoriesHook.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><select value={publishedFilter} onChange={(event) => setPublishedFilter(event.target.value)}><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Unpublished</option></select></div><VideoTable videos={videosHook.videos} categories={categoriesHook.categories} onEdit={openVideo} onDelete={removeVideo} onToggle={toggleVideo}/>{videosHook.hasMore && <button className="load-admin" onClick={videosHook.loadMore}>Load more</button>}</>}
      {section === "Categories" && <><div className="admin-heading"><div><span className="eyebrow">ORGANIZE</span><h1>Categories</h1><p>Create and manage library categories.</p></div><button className="button-primary" onClick={() => openCategory()}><Plus size={15}/> Add category</button></div><div className="category-admin-list">{categoriesHook.categories.map((category) => <div className="category-admin-row" key={category.id}><div><strong>{category.name}</strong><span>{category.description || "No description"}</span></div><span>{category.video_count ?? 0} videos</span><button onClick={() => openCategory(category)}>Edit</button><button aria-label={`Delete ${category.name}`} onClick={() => deleteCategory(category)}><Trash2 size={15}/></button></div>)}{categoriesHook.categories.length === 0 && <p className="admin-empty">No categories yet. Create one to organize videos.</p>}</div></>}
      {section === "Settings" && <><div className="admin-heading"><div><span className="eyebrow">ACCOUNT</span><h1>Settings</h1><p>Manage your admin session.</p></div></div><div className="settings-panel"><ShieldCheck size={18}/><div><strong>Protected with Supabase Auth</strong><span>Admin actions are enforced by database row-level security policies.</span></div><button onClick={logout}>Sign out</button></div><p className="admin-note">Video files are never uploaded. Playback streams directly from each external URL.</p></>}
    </section>
    {videoDialog && <div className="modal-backdrop" onMouseDown={() => setVideoDialog(false)}><section className="add-modal admin-form-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-title"><div><span className="eyebrow">VIDEO MANAGEMENT</span><h2>{editingVideo ? "Edit video" : "Add video"}</h2></div><button className="icon-button" onClick={() => setVideoDialog(false)}><X size={18}/></button></div><form onSubmit={submitVideo}><label>VIDEO URL<input name="video_url" type="url" required placeholder="https://cdn.example.com/video.mp4" defaultValue={editingVideo?.video_url}/><small>External HTTPS URL only. No upload field.</small></label><label>TITLE<input name="title" required maxLength={180} defaultValue={editingVideo?.title}/></label><label>CATEGORY<select name="category_id" required defaultValue={editingVideo?.category_id ?? categoriesHook.categories[0]?.id ?? ""}>{categoriesHook.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>DESCRIPTION<textarea name="description" rows={3} defaultValue={editingVideo?.description}/></label><label>THUMBNAIL URL<input name="thumbnail_url" type="url" placeholder="https://..." defaultValue={editingVideo?.thumbnail_url ?? ""}/></label><label>TAGS<input name="tags" placeholder="documentary, travel" defaultValue={editingVideo?.tags.join(", ")}/></label><label>DURATION<input name="duration" placeholder="12:34" defaultValue={editingVideo?.duration}/></label><div className="check-row"><label><input type="checkbox" name="featured" defaultChecked={editingVideo?.featured}/> Featured</label><label><input type="checkbox" name="published" defaultChecked={editingVideo?.published ?? true}/> Published</label></div><button className="button-primary submit-button" type="submit">{editingVideo ? "Save changes" : "Add video"}</button></form></section></div>}
    {categoryDialog && <div className="modal-backdrop" onMouseDown={() => setCategoryDialog(false)}><section className="add-modal admin-form-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-title"><div><span className="eyebrow">CATEGORY MANAGEMENT</span><h2>{editingCategory ? "Edit category" : "Add category"}</h2></div><button className="icon-button" onClick={() => setCategoryDialog(false)}><X size={18}/></button></div><form onSubmit={submitCategory}><label>NAME<input name="name" required maxLength={80} defaultValue={editingCategory?.name}/></label><label>DESCRIPTION<textarea name="description" rows={3} defaultValue={editingCategory?.description}/></label><label>IMAGE URL<input name="image_url" type="url" defaultValue={editingCategory?.image_url ?? ""}/></label><button className="button-primary submit-button" type="submit">{editingCategory ? "Save changes" : "Create category"}</button></form></section></div>}
  </main>;
}

function Stat({ label, value }: { label: string; value?: number }) { return <div className="stat-card"><span>{label}</span><strong>{value?.toLocaleString() ?? "—"}</strong><small>From your library</small></div>; }
function VideoTable({ videos, categories, onEdit, onDelete, onToggle }: { videos: VideoRecord[]; categories: Category[]; onEdit: (video: VideoRecord) => void; onDelete: (id: string) => void; onToggle: (video: VideoRecord, field: "published" | "featured") => void }) {
  return <div className="admin-table video-management-table"><div className="video-table-head"><span>VIDEO</span><span>CATEGORY</span><span>STATUS</span><span>VIEWS</span><span>ADDED</span><span>ACTIONS</span></div>{videos.map((video) => <div className="admin-row video-table-row" key={video.id}><img src={video.thumbnail_url || "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=180&q=75"} alt=""/><div className="admin-title"><strong>{video.title}</strong><span>{video.featured ? "Featured · " : ""}{video.duration || "Video"}</span></div><span>{video.categories?.name ?? categories.find((item) => item.id === video.category_id)?.name ?? "—"}</span><span>{video.published ? "Published" : "Draft"}</span><span>{video.views.toLocaleString()}</span><span>{new Date(video.created_at).toLocaleDateString()}</span><div className="row-actions"><button onClick={() => onEdit(video)}>Edit</button><button onClick={() => onToggle(video, "published")}>{video.published ? "Unpublish" : "Publish"}</button><button onClick={() => onToggle(video, "featured")}>{video.featured ? "Unfeature" : "Feature"}</button><button onClick={() => { if (window.confirm(`Delete “${video.title}”? This cannot be undone.`)) void onDelete(video.id); }} aria-label={`Delete ${video.title}`}><Trash2 size={14}/></button></div></div>)}{videos.length === 0 && <p className="admin-empty">No videos found.</p>}</div>;
}
