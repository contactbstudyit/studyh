"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Clapperboard, Filter, House, Play, Search } from "lucide-react";
import Link from "next/link";
import { VideoPlayer } from "@/components/video-player";
import type { VideoRecord } from "@/hooks/use-library";
import PublicViewCount from "@/components/public-view-count";
import type { VideoSourceType } from "@/lib/video-playback";

type ReelVideo = Omit<VideoRecord, "video_url" | "views" | "display_view_count" | "published_at" | "display_views">;
type ReelItem = { video: ReelVideo; playbackUrl: string; playbackType: VideoSourceType; sourceHost: string; displayViews: number };
type ReelResponse = { videos: ReelItem[]; page: number; pageSize: number; hasMore: boolean; error?: string };
type PlayerSlot = "a" | "b";
type PlayerSlots = Record<PlayerSlot, ReelItem | null>;

function otherPlayerSlot(slot: PlayerSlot): PlayerSlot {
  return slot === "a" ? "b" : "a";
}

export default function CategoryReels({ slug, categoryName }: { slug: string; categoryName: string }) {
  const [videos, setVideos] = useState<ReelItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [mobileViewport, setMobileViewport] = useState<boolean | null>(null);
  const [playerSlots, setPlayerSlots] = useState<PlayerSlots>({ a: null, b: null });
  const [activePlayerSlot, setActivePlayerSlot] = useState<PlayerSlot>("a");
  const trackRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const videosRef = useRef(videos);
  const activeIndexRef = useRef(activeIndex);
  const playerSlotsRef = useRef(playerSlots);
  const activePlayerSlotRef = useRef(activePlayerSlot);
  videosRef.current = videos;
  activeIndexRef.current = activeIndex;
  playerSlotsRef.current = playerSlots;
  activePlayerSlotRef.current = activePlayerSlot;

  const activateReel = useCallback((index: number) => {
    const items = videosRef.current;
    const target = items[index];
    if (!target) return;

    if (mobileViewport && index !== activeIndexRef.current) {
      const activeSlot = activePlayerSlotRef.current;
      const candidateSlot = otherPlayerSlot(activeSlot);
      const candidate = playerSlotsRef.current[candidateSlot];
      const promotedSlot = candidate?.video.id === target.video.id ? candidateSlot : activeSlot;
      const recycledSlot = otherPlayerSlot(promotedSlot);
      const next = items[index + 1] ?? null;
      const nextSlots: PlayerSlots = { a: null, b: null };
      nextSlots[promotedSlot] = target;
      nextSlots[recycledSlot] = next?.video.id !== target.video.id ? next : null;

      playerSlotsRef.current = nextSlots;
      setPlayerSlots(nextSlots);
      activePlayerSlotRef.current = promotedSlot;
      setActivePlayerSlot(promotedSlot);
    }

    if (index !== activeIndexRef.current) {
      activeIndexRef.current = index;
      setActiveIndex(index);
    }
  }, [mobileViewport]);

  const loadPage = useCallback(async (nextPage: number, replace = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError("");
    if (replace) {
      setLoading(true);
      setVideos([]);
      videosRef.current = [];
      setPage(0);
      setHasMore(true);
      activeIndexRef.current = 0;
      setActiveIndex(0);
      playerSlotsRef.current = { a: null, b: null };
      setPlayerSlots({ a: null, b: null });
      activePlayerSlotRef.current = "a";
      setActivePlayerSlot("a");
    } else setLoadingMore(true);
    try {
      const response = await fetch(`/api/public/category-reels/${encodeURIComponent(slug)}?page=${nextPage}`, { cache: "no-store" });
      const payload = await response.json() as ReelResponse;
      if (!response.ok) throw new Error("Could not load category reels.");
      setVideos((current) => replace ? payload.videos : [...current, ...payload.videos]);
      setPage(payload.page);
      setHasMore(payload.hasMore);
      if (replace) setActiveIndex(0);
    } catch {
      setError(replace ? "Could not load reels. Check your connection and try again." : "Could not load more reels. Try again.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [slug]);

  useEffect(() => { void loadPage(1, true); }, [loadPage]);

  useEffect(() => {
    const breakpoint = window.matchMedia("(max-width: 720px)");
    const update = () => setMobileViewport(breakpoint.matches);
    update();
    breakpoint.addEventListener("change", update);
    return () => breakpoint.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (mobileViewport !== true) {
      if (mobileViewport === false && (playerSlotsRef.current.a || playerSlotsRef.current.b)) {
        playerSlotsRef.current = { a: null, b: null };
        setPlayerSlots({ a: null, b: null });
        activePlayerSlotRef.current = "a";
        setActivePlayerSlot("a");
      }
      return;
    }

    const active = videos[activeIndex];
    if (!active) return;
    const selected = activePlayerSlotRef.current;
    const alternate = otherPlayerSlot(selected);
    const promotedSlot = playerSlotsRef.current[alternate]?.video.id === active.video.id ? alternate : selected;
    const recycledSlot = otherPlayerSlot(promotedSlot);
    const next = videos[activeIndex + 1] ?? null;
    const desired: PlayerSlots = { a: null, b: null };
    desired[promotedSlot] = active;
    desired[recycledSlot] = next?.video.id !== active.video.id ? next : null;
    const slotsChanged = (['a', 'b'] as const).some((slot) => playerSlotsRef.current[slot]?.video.id !== desired[slot]?.video.id);

    if (slotsChanged) {
      playerSlotsRef.current = desired;
      setPlayerSlots(desired);
    }
    if (activePlayerSlotRef.current !== promotedSlot) {
      activePlayerSlotRef.current = promotedSlot;
      setActivePlayerSlot(promotedSlot);
    }
  }, [activeIndex, mobileViewport, videos]);

  useEffect(() => {
    const root = trackRef.current;
    if (!root || videos.length === 0) return;
    const observer = new IntersectionObserver(() => {
      const rootBounds = root.getBoundingClientRect();
      let visibleIndex = -1;
      let visibleRatio = 0;
      root.querySelectorAll<HTMLElement>("[data-reel-index]").forEach((slide) => {
        const rect = slide.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(rect.bottom, rootBounds.bottom) - Math.max(rect.top, rootBounds.top));
        const ratio = rect.height > 0 ? visibleHeight / rect.height : 0;
        if (ratio > visibleRatio) {
          visibleRatio = ratio;
          visibleIndex = Number(slide.dataset.reelIndex);
        }
      });
      if (visibleRatio >= 0.6 && Number.isInteger(visibleIndex)) activateReel(visibleIndex);
    }, { root, threshold: [0.6, 0.8] });
    root.querySelectorAll<HTMLElement>("[data-reel-index]").forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, [activateReel, videos.length]);

  useEffect(() => {
    const remainingVideos = mobileViewport === true ? 4 : 2;
    const prefetchThreshold = Math.max(0, videos.length - remainingVideos);
    if (videos.length > 0 && activeIndex >= prefetchThreshold && hasMore && !loadingMore && !error) {
      void loadPage(page + 1);
    }
  }, [activeIndex, error, hasMore, loadPage, loadingMore, mobileViewport, page, videos.length]);

  return <main className="site-shell reels-page">
    <header className="topbar category-topbar reels-topbar">
      <Link className="reels-back" href={`/category/${encodeURIComponent(slug)}`} aria-label={`Back to ${categoryName} videos`}><ArrowLeft size={17}/></Link>
      <span className="reels-header-label"><Clapperboard size={14}/> Reels</span>
    </header>
    <nav className="reels-mobile-nav" aria-label="Reels navigation">
      <Link className="reels-mobile-control" href="/" aria-label="Home"><House size={18}/><span>Home</span></Link>
      <Link className="reels-mobile-control active" href={`/category/${encodeURIComponent(slug)}/reels`} aria-current="page" aria-label="Reels"><Clapperboard size={18}/><span>Reels</span></Link>
      <Link className="reels-mobile-control" href={`/category/${encodeURIComponent(slug)}?focusSearch=1`} aria-label="Search"><Search size={18}/><span>Search</span></Link>
      <Link className="reels-mobile-control" href={`/category/${encodeURIComponent(slug)}?openFilter=1`} aria-label="Filter"><Filter size={18}/><span>Filter</span></Link>
    </nav>

    {loading && videos.length === 0 ? <div className="reels-loading" role="status" aria-label={`Loading ${categoryName} reels`}><span className="spinner"/><span>Loading reels...</span></div>
      : error && videos.length === 0 ? <section className="reels-empty" role="alert"><strong>Could not load reels</strong><span>{error}</span><button className="button-secondary" type="button" onClick={() => void loadPage(1, true)}>Try again</button></section>
        : videos.length === 0 ? <section className="reels-empty"><Clapperboard size={22}/><strong>No videos in this category yet</strong><span>Check back later for new reels.</span><Link href={`/category/${encodeURIComponent(slug)}`}>Back to category</Link></section>
           : <div className="reels-track" ref={trackRef} aria-label={`${categoryName} reels`}>
             {videos.map((item, index) => {
               const desktopActive = mobileViewport === false && activeIndex === index;
               return <article className="reel-slide" data-reel-index={index} key={item.video.id} aria-label={`Video ${index + 1}: ${item.video.title}`}>
                 <div className="reel-card">
                   <div className="reel-media">
                     {!desktopActive && <div className="reel-poster-wrap"><img className="reel-poster" loading="lazy" src={item.video.thumbnail_url || "/film-placeholder.svg"} alt=""/><span className="reel-poster-play"><Play size={20} fill="currentColor"/></span></div>}
                     {desktopActive && <VideoPlayer video={item.video} playbackUrl={item.playbackUrl} playbackType={item.playbackType} sourceHost={item.sourceHost} muted controls/>}
                   </div>
                   <div className="reel-caption"><h1>{item.video.title}</h1><PublicViewCount count={item.displayViews} className="reel-view-count"/>{item.video.description && <p>{item.video.description}</p>}</div>
                 </div>
               </article>;
             })}
             {loadingMore && <div className="reels-load-status" role="status">Loading more reels...</div>}
             {error && videos.length > 0 && <div className="reels-load-status" role="alert"><span>{error}</span><button className="button-secondary" type="button" onClick={() => void loadPage(page + 1)}>Try again</button></div>}
             {!hasMore && videos.length > 0 && <div className="reels-load-status end">You are all caught up.</div>}
             {mobileViewport === true && <div className="reels-player-layer" aria-label="Active Reel playback" style={{ height: `${videos.length * 100}dvh` }}>
               {(["a", "b"] as const).map((slot) => {
                 const item = playerSlots[slot];
                 if (!item) return null;
                 const isActive = slot === activePlayerSlot;
                 const slotIndex = videos.findIndex((video) => video.video.id === item.video.id);
                 return <div className={`reel-player-slot ${isActive ? "active" : "preparing"}`} aria-hidden={!isActive} key={slot} style={{ top: `${Math.max(0, slotIndex) * 100}dvh` }}>
                   <VideoPlayer key={slot} video={item.video} playbackUrl={item.playbackUrl} playbackType={item.playbackType} sourceHost={item.sourceHost} muted controls={false} preloadOnly={!isActive}/>
                   {isActive && <div className="reel-caption mobile-reel-caption"><h1>{item.video.title}</h1><PublicViewCount count={item.displayViews} className="reel-view-count"/></div>}
                 </div>;
               })}
             </div>}
           </div>}
  </main>;
}
