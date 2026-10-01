"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, CirclePlay, Clapperboard, Clock3, Command, Film, Grid2X2, Heart, ListFilter, Menu, MoreHorizontal, Play, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Volume2, X } from "lucide-react";
import Hls from "hls.js";
import * as dashjs from "dashjs";

type Video = { id: number; title: string; category: string; description: string; image: string; duration: string; source: string; featured?: boolean };
const initialVideos: Video[] = [
  { id: 1, title: "The quiet art of doing nothing", category: "Culture", description: "A slower kind of Sunday, somewhere along the coast of Portugal.", image: "photo-1470252649378-9c29740c9fa8", duration: "18:42", source: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", featured: true },
  { id: 2, title: "Inside the world’s most remote kitchen", category: "Food", description: "One chef. One tiny island. A menu shaped by the tide.", image: "photo-1517248135467-4c7edcad34c4", duration: "24:16", source: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id: 3, title: "A light that never quite leaves", category: "Places", description: "Chasing the last gold hour in the north of Iceland.", image: "photo-1470770841072-f978cf4d019e", duration: "12:08", source: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id: 4, title: "Objects for a life well lived", category: "Design", description: "A furniture maker finds beauty in the imperfect.", image: "photo-1494438639946-1ebd1d20bf85", duration: "31:55", source: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id: 5, title: "The shape of a city at dawn", category: "Places", description: "Before the streets wake, Tokyo belongs to someone else.", image: "photo-1519608487953-e999c86e7455", duration: "09:34", source: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id: 6, title: "Made slowly, by hand", category: "Design", description: "A ceramic studio where the process is the point.", image: "photo-1493106641515-6b5631de4bb9", duration: "16:20", source: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id: 7, title: "A table for everyone", category: "Food", description: "At this neighborhood supper club, strangers become regulars.", image: "photo-1414235077428-338989a2e8c0", duration: "22:11", source: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id: 8, title: "Notes from the open road", category: "Culture", description: "A photographer and an old van head west, without a plan.", image: "photo-1464822759023-fed622ff2c3b", duration: "28:03", source: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
];
const imageUrl = (id: string, width = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;

export default function Home() {
  const [videos, setVideos] = useState(initialVideos);
  const [activeCategory, setActiveCategory] = useState("All stories");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Video | null>(null);
  const [admin, setAdmin] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const categories = useMemo(() => ["All", ...Array.from(new Set(videos.map((video) => video.category)))], [videos]);
  const featured = videos.find((video) => video.featured) ?? videos[0];
  const visible = useMemo(() => videos.filter((video) => (activeCategory === "All" || video.category === activeCategory) && `${video.title} ${video.description} ${video.category}`.toLowerCase().includes(query.toLowerCase())), [videos, activeCategory, query]);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };

  const saveVideo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const url = String(data.get("url") || "");
    try { if (new URL(url).protocol !== "https:") throw new Error(); } catch { notify("Enter a valid HTTPS video URL."); return; }
    const next: Video = { id: Date.now(), title: String(data.get("title")), category: String(data.get("category")), description: String(data.get("description") || "Added to your collection."), image: "photo-1470252649378-9c29740c9fa8", duration: "", source: url };
    setVideos((current) => [next, ...current]); setAddOpen(false); event.currentTarget.reset(); notify("Video link added to this session.");
  };

  return <main className="site-shell">
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={19}/></button>
      <a className="home-link" href="#top">Home</a>
      <nav className={`topnav ${menuOpen ? "nav-open" : ""}`} aria-label="Categories"><button className="nav-link" onClick={() => { document.getElementById("categories")?.scrollIntoView({ behavior: "smooth" }); setMenuOpen(false); }}>Categories</button></nav>
      <div className="header-actions"><label className="search-box"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a story" aria-label="Search stories"/><kbd>⌘ K</kbd></label><button className="admin-trigger" onClick={() => setAdmin(!admin)}>{admin ? <X size={15}/> : <Settings2 size={15}/>}<span>{admin ? "Close studio" : "Studio"}</span></button></div>
    </header>

    {admin ? <section className="admin-view"><div className="admin-heading"><div><span className="eyebrow">COLLECTION STUDIO</span><h1>Your library<span className="period">.</span></h1><p>Manage the stories you share with the world.</p></div><button className="button-primary" onClick={() => setAddOpen(true)}><Plus size={16}/> Add a video</button></div><div className="stats-row"><div className="stat-card"><span>Stories</span><strong>{videos.length.toString().padStart(2, "0")}</strong><small>In your collection</small></div><div className="stat-card"><span>Collections</span><strong>{categories.length - 1}</strong><small>Curated for discovery</small></div><div className="stat-card"><span>Recently added</span><strong>Today</strong><small>Updated just now</small></div></div><div className="table-heading"><h2>All stories</h2><span>{videos.length} entries <ChevronDown size={14}/></span></div><div className="admin-table">{videos.map((video) => <div className="admin-row" key={video.id}><img src={imageUrl(video.image, 180)} alt=""/><div className="admin-title"><strong>{video.title}</strong><span>{video.category}</span></div><span className="status"><i/> Published</span><button className="icon-button" aria-label={`Remove ${video.title}`} onClick={() => { setVideos((current) => current.filter((entry) => entry.id !== video.id)); notify("Story removed from this session."); }}><MoreHorizontal size={18}/></button></div>)}</div><p className="admin-note"><ShieldCheck size={15}/> Videos are played directly from their external URLs. No video files are uploaded.</p></section> : <>
      <section className="collection section-wrap" id="top"><div className="section-header"><div><h1>{activeCategory === "All" ? "Latest Videos" : activeCategory}</h1></div><span className="result-count">{visible.length} videos</span></div><div className="category-strip" id="categories"><div className="category-label">Categories</div><div className="category-chips">{categories.map((category) => <button key={category} onClick={() => setActiveCategory(category)} className={`category-chip ${activeCategory === category ? "selected" : ""}`}>{category}<span>{category === "All" ? videos.length : videos.filter((video) => video.category === category).length}</span></button>)}</div></div>
        <div className="video-grid">{visible.map((video, index) => <article className="video-card" key={video.id} style={{ animationDelay: `${index * 55}ms` }}><button className="thumbnail-button" onClick={() => setSelected(video)} aria-label={`Watch ${video.title}`}><img loading="lazy" src={imageUrl(video.image)} alt=""/><span className="thumb-shade"/><span className="play-disc"><Play size={17} fill="currentColor"/></span>{video.duration && <span className="duration"><Clock3 size={11}/>{video.duration}</span>}<span className="card-number">{String(index + 2).padStart(2, "0")}</span></button><div className="card-meta"><span>{video.category}</span><button aria-label="Save story" onClick={() => notify("Saved to your list.")}><Heart size={15}/></button></div><button className="card-title" onClick={() => setSelected(video)}>{video.title}</button><p className="card-description">{video.description}</p></article>)}</div>
        {visible.length === 0 && <div className="empty-state"><Search size={22}/><strong>No stories found</strong><span>Try another search or choose a different collection.</span></div>}
        {visible.length > 8 && <div className="load-more"><span/> <button onClick={() => { setActiveCategory("All"); setQuery(""); }}>YOU’VE REACHED THE END <ArrowDown size={13}/></button> <span/></div>}
      </section>
      <footer className="footer"><span>Video library</span><button onClick={() => setAdmin(true)}>Collection studio <ArrowRight size={13}/></button></footer>
    </>}

    {selected && <div className="modal-backdrop" role="presentation" onClick={() => setSelected(null)}><section className="watch-modal" role="dialog" aria-modal="true" aria-label={selected.title} onClick={(event) => event.stopPropagation()}><div className="watch-top"><span><span className="live-dot"/> NOW PLAYING</span><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close player"><X size={19}/></button></div><VideoPlayer video={selected}/><div className="watch-info"><div><span className="eyebrow">{selected.category} · {selected.duration || "ON DEMAND"}</span><h2>{selected.title}</h2><p>{selected.description}</p></div><button className="round-action" onClick={() => notify("Saved to your list.")} aria-label="Save story"><Plus size={19}/></button></div><div className="source-note"><Check size={13}/> Streaming directly from its source. Nothing is stored here.</div></section></div>}
    {addOpen && <div className="modal-backdrop" role="presentation" onClick={() => setAddOpen(false)}><section className="add-modal" role="dialog" aria-modal="true" aria-label="Add a video" onClick={(event) => event.stopPropagation()}><div className="modal-title"><div><span className="eyebrow">COLLECTION STUDIO</span><h2>Add a story<span className="period">.</span></h2></div><button className="icon-button" onClick={() => setAddOpen(false)} aria-label="Close"><X size={19}/></button></div><p className="form-intro">Add an external video link. The video stays wherever it is hosted.</p><form onSubmit={saveVideo}><label>VIDEO URL<input name="url" required type="url" placeholder="https://cdn.example.com/film.mp4"/><small>MP4, WebM, HLS (.m3u8) and DASH (.mpd) links supported.</small></label><label>STORY TITLE<input name="title" required placeholder="Give this story a name"/></label><label>COLLECTION<select name="category" defaultValue={categories[1]}>{categories.slice(1).map((category) => <option key={category}>{category}</option>)}</select></label><label>DESCRIPTION<textarea name="description" rows={3} placeholder="A little context goes a long way"/></label><button className="button-primary submit-button" type="submit"><Plus size={15}/> Add to collection</button></form><div className="upload-note"><ShieldCheck size={15}/> Link only — no upload field, no copies.</div></section></div>}
    {toast && <div className="toast"><Check size={15}/>{toast}</div>}
  </main>;
}

function VideoPlayer({ video }: { video: Video }) {
  const [error, setError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const path = video.source.split("?")[0].toLowerCase();
    let hls: Hls | undefined;
    let dash: { initialize: (media: HTMLVideoElement, source: string, autoplay: boolean) => void; on: (event: string, callback: () => void) => void; reset: () => void } | undefined;
    if (path.endsWith(".m3u8")) {
      if (element.canPlayType("application/vnd.apple.mpegurl")) element.src = video.source;
      else if (Hls.isSupported()) { hls = new Hls({ enableWorker: true }); hls.loadSource(video.source); hls.attachMedia(element); hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setError(true); }); }
      else setError(true);
    } else if (path.endsWith(".mpd")) {
      try { const factory = dashjs.MediaPlayer() as unknown as { create: () => typeof dash }; dash = factory.create(); dash?.initialize(element, video.source, true); dash?.on("error", () => setError(true)); }
      catch { setError(true); }
    } else element.src = video.source;
    return () => { hls?.destroy(); dash?.reset(); };
  }, [video.source]);
  return <div className="player-frame"><video ref={videoRef} controls autoPlay playsInline preload="metadata" poster={imageUrl(video.image, 1200)} onError={() => setError(true)}/>{error && <div className="player-error"><Film size={25}/><strong>This video source does not allow browser playback.</strong><span>Check that the external host permits playback and supports byte-range requests.</span></div>}<span className="player-hint"><Command size={12}/> SPACE TO PLAY</span></div>;
}
