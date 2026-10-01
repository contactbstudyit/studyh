"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, Command, Film, Menu, Play, Search, Settings2, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { Category, useCategories, useVideos, VideoRecord } from "@/hooks/use-library";
import { detectSourceType, getPlaybackFailureReason, getSourceHost, probeVideoSource, SourceProbe, VideoSourceType } from "@/lib/video-playback";

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
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [sourceType, setSourceType] = useState<VideoSourceType>("unknown");
  const [diagnostics, setDiagnostics] = useState<SourceProbe & { sourceType: VideoSourceType; hlsType: string | null; hlsDetails: string | null; hlsStatus: number | null; hlsUrl: string | null; mediaErrorCode: number | null }>({
    status: null, contentType: null, finalHost: null, error: null,
    sourceType: "unknown", hlsType: null, hlsDetails: null, hlsStatus: null, hlsUrl: null, mediaErrorCode: null,
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    let active = true;
    let hls: import("hls.js").default | undefined;
    let dash: { initialize: (media: HTMLVideoElement, source: string, autoplay: boolean) => void; on: (event: string, callback: (event?: unknown) => void) => void; reset: () => void } | undefined;
    let probe: SourceProbe | null = null;
    let resolvedType = detectSourceType(video.video_url);
    const host = getSourceHost(video.video_url);
    const initialType = resolvedType;
    setFailure(""); setLoading(true); setSourceType(initialType);
    setDiagnostics({ status: null, contentType: null, finalHost: null, error: null, sourceType: initialType, hlsType: null, hlsDetails: null, hlsStatus: null, hlsUrl: null, mediaErrorCode: null });
    if (process.env.NODE_ENV === "development") console.info("[video-playback] source selected", { sourceHost: host, sourceType: initialType, hasThumbnail: Boolean(video.thumbnail_url), attempt });

    const recordProbe = (result: SourceProbe) => {
      probe = result;
      if (!active) return;
      const detectedType = detectSourceType(video.video_url, result.contentType);
      setSourceType((current) => current === "unknown" ? detectedType : current);
      setDiagnostics((current) => ({ ...current, ...result, sourceType: current.sourceType === "unknown" ? detectedType : current.sourceType }));
      if (process.env.NODE_ENV === "development") console.info("[video-playback] source metadata", { sourceHost: host, sourceType: detectedType, status: result.status, contentType: result.contentType, finalHost: result.finalHost, error: result.error });
    };
    const probePromise = initialType === "unknown" ? probeVideoSource(video.video_url) : null;
    if (probePromise) void probePromise.then(recordProbe);

    const fail = (detail?: { hlsType?: string; hlsDetails?: string; hlsStatus?: number | null; hlsUrl?: string | null }) => {
      if (!active) return;
      const type = detail?.hlsType ?? null;
      const details = detail?.hlsDetails ?? null;
      const status = detail?.hlsStatus ?? null;
      const hlsUrl = detail?.hlsUrl ?? null;
      setLoading(false);
      setDiagnostics((current) => ({ ...current, hlsType: type, hlsDetails: details, hlsStatus: status, hlsUrl }));
      const reason = getPlaybackFailureReason({
        sourceType: detectSourceType(video.video_url, probe?.contentType),
        httpStatus: probe?.status ?? null,
        probeError: probe?.error ?? null,
        hlsType: type,
        hlsDetails: details,
        hlsStatus: status,
      });
      setFailure(reason);
      if (process.env.NODE_ENV === "development") console.error("[video-playback] failed", { sourceHost: host, sourceType: detectSourceType(video.video_url, probe?.contentType), httpStatus: status ?? probe?.status ?? null, contentType: probe?.contentType ?? null, hlsType: type, hlsDetails: details, hlsStatus: status, reason });
    };

    element.pause();
    element.removeAttribute("src");
    element.load();
    void (async () => {
      try {
        let type = initialType;
        if (type === "unknown" && probePromise) {
          const metadata = await probePromise;
          type = detectSourceType(video.video_url, metadata.contentType);
        }
        if (!active) return;
        resolvedType = type;
        setSourceType(type);
        setDiagnostics((current) => ({ ...current, sourceType: type }));
        if (type === "hls") {
          if (element.canPlayType("application/vnd.apple.mpegurl")) {
            element.src = video.video_url;
            element.load();
          } else {
            const HlsPlayer = (await import("hls.js")).default;
            if (!active) return;
            if (!HlsPlayer.isSupported()) { fail({ hlsType: "unsupported", hlsDetails: "HLS is not supported by this browser" }); return; }
            hls = new HlsPlayer({ enableWorker: true, lowLatencyMode: false });
            hls.on(HlsPlayer.Events.MEDIA_ATTACHED, () => {
              if (process.env.NODE_ENV === "development") console.info("[video-playback] HLS media attached", { sourceHost: host });
            });
            hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
              if (!active) return;
              setLoading(false);
              if (process.env.NODE_ENV === "development") console.info("[video-playback] HLS manifest parsed", { sourceHost: host });
              void element.play().catch((error: unknown) => {
                if (process.env.NODE_ENV === "development") console.info("[video-playback] autoplay not allowed; native controls remain available", error instanceof Error ? error.message : error);
              });
            });
            hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
              const status = data.response?.code ?? null;
              const actualUrl = data.url ?? data.response?.url ?? null;
              const detail = { hlsType: String(data.type), hlsDetails: String(data.details), hlsStatus: status, hlsUrl: actualUrl };
              if (process.env.NODE_ENV === "development") console[data.fatal ? "error" : "warn"]("[video-playback] HLS diagnostics", { source: host, type: "HLS", fatal: data.fatal, details: data.details, httpStatus: status, url: actualUrl, error: data.error?.message ?? null });
              if (data.fatal) fail(detail);
            });
            hls.loadSource(video.video_url);
            hls.attachMedia(element);
          }
        } else if (type === "dash") {
          const dashModule = await import("dashjs");
          if (!active) return;
          const factory = dashModule.MediaPlayer() as unknown as { create: () => typeof dash };
          dash = factory.create();
          if (!dash) { fail({ hlsType: "DASH", hlsDetails: "DASH player could not be initialized" }); return; }
          dash.initialize(element, video.video_url, true);
          dash.on(dashModule.MediaPlayer.events.ERROR, (event) => {
            const info = event && typeof event === "object" ? event as { error?: { message?: string }; code?: number; message?: string } : {};
            const details = info.error?.message ?? info.message ?? "DASH playback error";
            const detail = { hlsType: "DASH", hlsDetails: details, hlsStatus: info.code ?? undefined };
            if (process.env.NODE_ENV === "development") console.error("[video-playback] DASH error", { sourceHost: host, ...detail });
            fail(detail);
          });
        } else {
          element.src = video.video_url;
          element.load();
        }
      } catch (error) {
        const details = error instanceof Error ? error.message : "Player initialization failed";
        if (process.env.NODE_ENV === "development") console.error("[video-playback] player initialization failed", { sourceHost: host, sourceType: resolvedType, error: details });
        fail({ hlsType: "player initialization", hlsDetails: details });
      }
    })();
    return () => { active = false; hls?.destroy(); dash?.reset(); element.pause(); element.removeAttribute("src"); element.load(); };
  }, [video.video_url, attempt]);

  function handleMediaError(event: React.SyntheticEvent<HTMLVideoElement>) {
    if (failure) return;
    const mediaErrorCode = event.currentTarget.error?.code ?? null;
    const reason = getPlaybackFailureReason({ sourceType, httpStatus: diagnostics.status, probeError: diagnostics.error, mediaErrorCode, hlsType: diagnostics.hlsType, hlsDetails: diagnostics.hlsDetails, hlsStatus: diagnostics.hlsStatus });
    setDiagnostics((current) => ({ ...current, mediaErrorCode }));
    setLoading(false); setFailure(reason);
    if (process.env.NODE_ENV === "development") console.error("[video-playback] HTMLMediaElement error", { sourceHost: getSourceHost(video.video_url), sourceType, httpStatus: diagnostics.status, contentType: diagnostics.contentType, corsProbeError: diagnostics.error, mediaErrorCode, mediaErrorMessage: event.currentTarget.error?.message, reason });
  }

  const sourceHost = getSourceHost(video.video_url);
  const diagnosticLines = [
    `Source: ${sourceHost}`,
    `Type: ${sourceType.toUpperCase()}`,
    diagnostics.hlsStatus !== null ? `Media HTTP status: ${diagnostics.hlsStatus}` : diagnostics.status !== null ? `Metadata HTTP status: ${diagnostics.status}` : null,
    diagnostics.contentType ? `Content-Type: ${diagnostics.contentType}` : null,
    diagnostics.hlsDetails ? `Player detail: ${diagnostics.hlsDetails}` : null,
  ].filter(Boolean);
  return <div className="player-frame" data-source-type={sourceType}>
    <video ref={videoRef} controls autoPlay playsInline preload="metadata" poster={video.thumbnail_url || undefined} onLoadedMetadata={() => setLoading(false)} onCanPlay={() => setLoading(false)} onPlaying={() => setLoading(false)} onWaiting={() => setLoading(true)} onError={handleMediaError}/>
    {loading && !failure && <div className="player-loading"><span className="spinner"/><span>Loading video...</span></div>}
    {failure && <div className="player-error"><Film size={24}/><strong>Unable to play this video</strong><span className="player-reason">{failure}</span><span className="player-diagnostics">{diagnosticLines.join(" · ")}</span><button type="button" onClick={() => { setFailure(""); setAttempt((current) => current + 1); }}>Try again</button></div>}
    <span className="player-hint"><Command size={12}/> SPACE TO PLAY</span>
  </div>;
}
