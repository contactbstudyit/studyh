"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, Command, Film, Menu, Play, Search, Settings2, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { Category, useCategories, useVideos, VideoRecord } from "@/hooks/use-library";

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
      {videosHook.loading && videosHook.videos.length === 0 ? <div className="library-loading"><span className="spinner"/> Loading videos</div> : <div className="video-grid">{videosHook.videos.map((video) => <article className="video-card" key={video.id}><button className="thumbnail-button" onClick={() => setSelected(video)} aria-label={`Watch ${video.title}`}><img loading="lazy" src={video.thumbnail_url || "/film-placeholder.svg"} alt=""/><span className="thumb-shade"/><span className="play-disc"><Play size={17} fill="currentColor"/></span>{video.duration && <span className="duration"><Clock3 size={11}/>{video.duration}</span>}</button><div className="card-meta"><span>{video.categories?.name ?? categories.find((category) => category.id === video.category_id)?.name ?? ""}</span></div><button className="card-title" onClick={() => setSelected(video)}>{video.title}</button>{video.description && <p className="card-description">{video.description}</p>}</article>)}</div>}
      {!videosHook.loading && videosHook.videos.length === 0 && <div className="empty-state"><Search size={22}/><strong>No videos found</strong><span>Try a different search or category.</span></div>}
      {videosHook.hasMore && <div className="pagination"><button onClick={videosHook.loadMore} disabled={videosHook.loading}>{videosHook.loading ? "Loading..." : "Load more videos"}</button></div>}
    </section>
    <footer className="footer"><span>Video library</span><Link href="/admin">Admin sign in <ShieldCheck size={13}/></Link></footer>
    {selected && <div className="modal-backdrop" role="presentation" onClick={() => setSelected(null)}><section className="watch-modal" role="dialog" aria-modal="true" aria-label={selected.title} onClick={(event) => event.stopPropagation()}><div className="watch-top"><span><span className="live-dot"/> NOW PLAYING</span><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close player"><X size={19}/></button></div><VideoPlayer video={selected}/><div className="watch-info"><div><span className="eyebrow">{selected.categories?.name ?? categories.find((category) => category.id === selected.category_id)?.name} · {selected.views.toLocaleString()} views</span><h2>{selected.title}</h2><p>{selected.description}</p></div></div><div className="source-note"><Check size={13}/> Streaming directly from its source. Nothing is stored here.</div></section></div>}
  </main>;
}

function CategoryPill({ category, selected, onClick }: { category: Category; selected: boolean; onClick: () => void }) { return <button className={`category-chip ${selected ? "selected" : ""}`} onClick={onClick}>{category.name}</button>; }

function VideoPlayer({ video }: { video: VideoRecord }) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    let active = true;
    const fail = () => { if (active) { setLoading(false); setError(true); } };
    const path = video.video_url.split("?")[0].toLowerCase();
    let hls: import("hls.js").default | undefined;
    let dash: { initialize: (media: HTMLVideoElement, source: string, autoplay: boolean) => void; on: (event: string, callback: () => void) => void; reset: () => void } | undefined;
    void (async () => {
      try {
        if (path.endsWith(".m3u8")) {
          if (element.canPlayType("application/vnd.apple.mpegurl")) element.src = video.video_url;
          else { const HlsPlayer = (await import("hls.js")).default; if (!active) return; if (!HlsPlayer.isSupported()) { fail(); return; } hls = new HlsPlayer({ enableWorker: true }); hls.loadSource(video.video_url); hls.attachMedia(element); hls.on(HlsPlayer.Events.ERROR, (_event, data) => { if (data.fatal) fail(); }); }
        } else if (path.endsWith(".mpd")) {
          const dashModule = await import("dashjs"); if (!active) return; const factory = dashModule.MediaPlayer() as unknown as { create: () => typeof dash }; dash = factory.create(); dash?.initialize(element, video.video_url, true); dash?.on("error", fail);
        } else element.src = video.video_url;
      } catch { fail(); }
    })();
    return () => { active = false; hls?.destroy(); dash?.reset(); };
  }, [video.video_url]);
  return <div className="player-frame"><video ref={videoRef} controls autoPlay playsInline preload="metadata" poster={video.thumbnail_url ?? undefined} onPlaying={() => setLoading(false)} onWaiting={() => setLoading(true)} onError={() => { setLoading(false); setError(true); }}/>{loading && !error && <div className="player-loading"><span className="spinner"/><span>Loading video...</span></div>}{error && <div className="player-error"><Film size={24}/><strong>Unable to play this video</strong><span>The video source may not allow browser playback or may be unavailable.</span></div>}<span className="player-hint"><Command size={12}/> SPACE TO PLAY</span></div>;
}
