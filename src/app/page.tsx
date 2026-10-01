"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Command, Menu, Play, Search, Settings2, X } from "lucide-react";
import Link from "next/link";
import { Category, useCategories, useVideos, VideoRecord } from "@/hooks/use-library";
import { getCategorySlug, slugifyCategory } from "@/lib/category-slug";
import { VideoPlayer } from "@/components/video-player";

export default function Home() {
  const [activeCategory, setActiveCategory] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<VideoRecord | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const categoriesHook = useCategories();
  const searchCategoryIds = useMemo(() => categoriesHook.categories.filter((category) => category.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((category) => category.id), [categoriesHook.categories, query]);
  const videosHook = useVideos({ categoryId: activeCategory || undefined, search: query, searchCategoryIds });
  const categories = useMemo(() => categoriesHook.categories, [categoriesHook.categories]);

  useEffect(() => { if (selected) void videosHook.recordView(selected.id); }, [selected?.id]);

  return <main className="site-shell">
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={18}/></button>
      <Link className="home-link" href="/">Home</Link>
      <nav className={`topnav ${menuOpen ? "nav-open" : ""}`} aria-label="Categories"><button className="nav-link" onClick={() => { document.getElementById("categories")?.scrollIntoView({ behavior: "smooth" }); setMenuOpen(false); }}>Categories</button></nav>
      <div className="header-actions"><label className="search-box"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos" aria-label="Search videos"/><kbd><Command size={10}/> K</kbd></label><Link className="admin-trigger" href="/admin"><Settings2 size={15}/><span>Admin</span></Link></div>
    </header>
    <section className="collection section-wrap" id="top">
      <div className="section-header"><h1>{categories.find((category) => category.id === activeCategory)?.name ?? "Latest Videos"}</h1><span className="result-count">{videosHook.videos.length}{videosHook.hasMore ? "+" : ""} videos</span></div>
      <div className="category-strip" id="categories"><div className="category-label">Categories</div><div className="category-chips"><button className={`category-chip ${activeCategory === "" ? "selected" : ""}`} onClick={() => setActiveCategory("")}>All</button>{categories.map((category) => <CategoryPill key={category.id} category={category} selected={activeCategory === category.id} onClick={() => setActiveCategory(category.id)}/>)}</div></div>
      {videosHook.loading && videosHook.videos.length === 0 ? <div className="video-grid skeleton-grid" role="status" aria-label="Loading videos">{Array.from({ length: 6 }, (_, index) => <article className="video-card skeleton-card" key={index}><div className="skeleton-thumbnail"/><div className="skeleton-meta"><span/></div><div className="skeleton-title"><span/><span/></div></article>)}</div> : <div className="video-grid">{videosHook.videos.map((video) => <article className="video-card" key={video.id}><button className="thumbnail-button" onClick={() => setSelected(video)} aria-label={`Watch ${video.title}`}><img loading="lazy" src={video.thumbnail_url || "/film-placeholder.svg"} alt=""/><span className="thumb-shade"/><span className="play-disc"><Play size={17} fill="currentColor"/></span>{video.duration && <span className="duration"><Clock3 size={11}/>{video.duration}</span>}</button><div className="card-meta"><span>{videoCategoryLink(video, categories)}</span></div><button className="card-title" onClick={() => setSelected(video)}>{video.title}</button>{video.description && <p className="card-description">{video.description}</p>}</article>)}</div>}
      {!videosHook.loading && videosHook.videos.length === 0 && <div className="empty-state"><Search size={22}/><strong>No videos found</strong><span>Try a different search or category.</span></div>}
      {videosHook.hasMore && <div className="pagination"><button onClick={videosHook.loadMore} disabled={videosHook.loading}>{videosHook.loading ? "Loading..." : "Load more videos"}</button></div>}
    </section>
    {selected && <div className="modal-backdrop" role="presentation" onClick={() => setSelected(null)}><section className="watch-modal" role="dialog" aria-modal="true" aria-label={selected.title} onClick={(event) => event.stopPropagation()}><div className="watch-top"><span><span className="live-dot"/> NOW PLAYING</span><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close player"><X size={19}/></button></div><VideoPlayer video={selected}/><div className="watch-info"><div><span className="eyebrow">{selected.categories?.name ?? categories.find((category) => category.id === selected.category_id)?.name} · {selected.views.toLocaleString()} views</span><h2>{selected.title}</h2><p>{selected.description}</p></div></div><div className="source-note"><Check size={13}/> Streaming directly from its source. Nothing is stored here.</div></section></div>}
  </main>;
}

function CategoryPill({ category, selected, onClick }: { category: Category; selected: boolean; onClick: () => void }) { return <button className={`category-chip ${selected ? "selected" : ""}`} onClick={onClick}>{category.name}</button>; }

function videoCategoryLink(video: VideoRecord, categories: Category[]) {
  const category = categories.find((item) => item.id === video.category_id);
  const name = video.categories?.name ?? category?.name;
  if (!name) return null;
  const slug = category ? getCategorySlug(category, categories) : slugifyCategory(name);
  return <Link className="card-category-link" href={`/category/${slug}`}>{name}</Link>;
}
