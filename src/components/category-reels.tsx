"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Clapperboard, Play, VolumeX } from "lucide-react";
import Link from "next/link";
import { VideoPlayer } from "@/components/video-player";
import MobileBottomNavigation from "@/components/mobile-bottom-navigation";
import type { VideoRecord } from "@/hooks/use-library";
import PublicViewCount from "@/components/public-view-count";
import type { VideoSourceType } from "@/lib/video-playback";
import { VastAdPlayer } from "@/components/vast-ad-player";

type ReelVideo = Omit<VideoRecord, "video_url" | "views" | "display_view_count" | "published_at" | "display_views">;
type ReelItem = { video: ReelVideo; playbackUrl: string; playbackType: VideoSourceType; sourceHost: string; displayViews: number };
type ReelResponse = { videos: ReelItem[]; page: number; pageSize: number; hasMore: boolean; error?: string };
type PlayerSlot = "a" | "b";
type PlayerSlots = Record<PlayerSlot, ReelItem | null>;
type ReelPlaybackStatus = "loading" | "ready" | "error";
type ReelAudioAvailability = "unknown" | "available" | "none";

function reelAdDiagnostic(event: string, details: Record<string, number | string> = {}) {
  if (process.env.NODE_ENV === "development") console.info("[reel-ad-diagnostic]", event, details);
}

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
  const [activePlaybackStatus, setActivePlaybackStatus] = useState<ReelPlaybackStatus>("loading");
  const [activeAudioAvailability, setActiveAudioAvailability] = useState<ReelAudioAvailability>("unknown");
  const [adRequested, setAdRequested] = useState(false);
  const [adReady, setAdReady] = useState(false);
  const [adPlaying, setAdPlaying] = useState(false);
  const [adIndex, setAdIndex] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const videosRef = useRef(videos);
  const activeIndexRef = useRef(activeIndex);
  const playerSlotsRef = useRef(playerSlots);
  const activePlayerSlotRef = useRef(activePlayerSlot);
  const adRequestedRef = useRef(false);
  const adReadyRef = useRef(false);
  const adPlayingRef = useRef(false);
  const adIndexRef = useRef<number | null>(null);
  const consumedReelsRef = useRef(new Set<string>());
  const consumedCountRef = useRef(0);
  const nextAdAtRef = useRef(3 + Math.floor(Math.random() * 3));
  const slotPlaybackStatusRef = useRef<Record<PlayerSlot, ReelPlaybackStatus>>({ a: "loading", b: "loading" });
  const slotAudioAvailabilityRef = useRef<Record<PlayerSlot, { videoId: string | null; availability: ReelAudioAvailability }>>({
    a: { videoId: null, availability: "unknown" },
    b: { videoId: null, availability: "unknown" },
  });
  videosRef.current = videos;
  activeIndexRef.current = activeIndex;
  playerSlotsRef.current = playerSlots;
  activePlayerSlotRef.current = activePlayerSlot;

  const activateReel = useCallback((index: number, bypassAd = false) => {
    const items = videosRef.current;
    const target = items[index];
    if (!target) return;

    if (adRequestedRef.current && !adReadyRef.current && index !== activeIndexRef.current) {
      reelAdDiagnostic("swipe while VAST request is pending; normal Reel continues", { consumed: consumedCountRef.current, threshold: nextAdAtRef.current });
    }

    if (adPlayingRef.current) {
      if (index === adIndexRef.current) return;
      reelAdDiagnostic("pending ad cancelled by swipe", { consumed: consumedCountRef.current, threshold: nextAdAtRef.current });
      adPlayingRef.current = false; setAdPlaying(false);
      adReadyRef.current = false; setAdReady(false);
      adRequestedRef.current = false; setAdRequested(false);
      adIndexRef.current = null; setAdIndex(null);
      nextAdAtRef.current = consumedCountRef.current + 3 + Math.floor(Math.random() * 3);
    }

    if (!bypassAd && mobileViewport && index !== activeIndexRef.current && !adPlayingRef.current && adReadyRef.current && consumedCountRef.current >= nextAdAtRef.current) {
      reelAdDiagnostic("ready ad activated for next Reel", { consumed: consumedCountRef.current, threshold: nextAdAtRef.current });
      adIndexRef.current = index; setAdIndex(index);
      adPlayingRef.current = true; setAdPlaying(true);
      return;
    }

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

      for (const slot of ["a", "b"] as const) {
        if (playerSlotsRef.current[slot]?.video.id !== nextSlots[slot]?.video.id) {
          slotPlaybackStatusRef.current[slot] = "loading";
          slotAudioAvailabilityRef.current[slot] = { videoId: nextSlots[slot]?.video.id ?? null, availability: "unknown" };
        }
      }
      playerSlotsRef.current = nextSlots;
      setPlayerSlots(nextSlots);
      activePlayerSlotRef.current = promotedSlot;
      setActivePlayerSlot(promotedSlot);
      setActivePlaybackStatus(slotPlaybackStatusRef.current[promotedSlot]);
      const audioState = slotAudioAvailabilityRef.current[promotedSlot];
      setActiveAudioAvailability(audioState.videoId === target.video.id ? audioState.availability : "unknown");
    }

    if (index !== activeIndexRef.current) {
      activeIndexRef.current = index;
      setActiveIndex(index);
    }
  }, [mobileViewport]);

  const onNormalPlaybackStarted = useCallback((videoId: string) => {
    if (consumedReelsRef.current.has(videoId)) return;
    consumedReelsRef.current.add(videoId);
    consumedCountRef.current += 1;
    reelAdDiagnostic("normal Reel playback consumed", { consumed: consumedCountRef.current, threshold: nextAdAtRef.current });
    if (mobileViewport && !adRequestedRef.current && consumedCountRef.current >= nextAdAtRef.current) {
      adRequestedRef.current = true;
      reelAdDiagnostic("frequency threshold reached; VAST request scheduled", { consumed: consumedCountRef.current, threshold: nextAdAtRef.current });
      setAdRequested(true);
    }
  }, [mobileViewport]);

  const onAdReady = useCallback(() => {
    adReadyRef.current = true;
    reelAdDiagnostic("VAST ad is ready for presentation", { consumed: consumedCountRef.current, threshold: nextAdAtRef.current });
    setAdReady(true);
  }, []);

  const onAdFinish = useCallback(() => {
    const pendingIndex = adIndexRef.current;
    adPlayingRef.current = false; setAdPlaying(false);
    adReadyRef.current = false; setAdReady(false);
    adRequestedRef.current = false; setAdRequested(false);
    adIndexRef.current = null; setAdIndex(null);
    nextAdAtRef.current = consumedCountRef.current + 3 + Math.floor(Math.random() * 3);
    if (pendingIndex !== null) activateReel(pendingIndex, true);
  }, [activateReel]);

  const loadPage = useCallback(async (nextPage: number, replace = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError("");
    if (replace) {
      adRequestedRef.current = false; adReadyRef.current = false; adPlayingRef.current = false; adIndexRef.current = null;
      consumedReelsRef.current.clear(); consumedCountRef.current = 0; nextAdAtRef.current = 3 + Math.floor(Math.random() * 3);
      setAdRequested(false); setAdReady(false); setAdPlaying(false); setAdIndex(null);
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
      slotPlaybackStatusRef.current = { a: "loading", b: "loading" };
      setActivePlaybackStatus("loading");
      slotAudioAvailabilityRef.current = { a: { videoId: null, availability: "unknown" }, b: { videoId: null, availability: "unknown" } };
      setActiveAudioAvailability("unknown");
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

  const reportSlotPlaybackStatus = useCallback((slot: PlayerSlot, videoId: string, status: ReelPlaybackStatus) => {
    if (playerSlotsRef.current[slot]?.video.id !== videoId) return;
    slotPlaybackStatusRef.current[slot] = status;
    if (activePlayerSlotRef.current === slot) setActivePlaybackStatus(status);
  }, []);

  const reportSlotAudioAvailability = useCallback((slot: PlayerSlot, videoId: string, availability: ReelAudioAvailability) => {
    if (playerSlotsRef.current[slot]?.video.id !== videoId) return;
    slotAudioAvailabilityRef.current[slot] = { videoId, availability };
    if (activePlayerSlotRef.current === slot) setActiveAudioAvailability(availability);
  }, []);

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
        adRequestedRef.current = false; adReadyRef.current = false; adPlayingRef.current = false; adIndexRef.current = null;
        setAdRequested(false); setAdReady(false); setAdPlaying(false); setAdIndex(null);
        playerSlotsRef.current = { a: null, b: null };
        setPlayerSlots({ a: null, b: null });
        activePlayerSlotRef.current = "a";
        setActivePlayerSlot("a");
        slotPlaybackStatusRef.current = { a: "loading", b: "loading" };
        setActivePlaybackStatus("loading");
        slotAudioAvailabilityRef.current = { a: { videoId: null, availability: "unknown" }, b: { videoId: null, availability: "unknown" } };
        setActiveAudioAvailability("unknown");
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
      for (const slot of ["a", "b"] as const) {
        if (playerSlotsRef.current[slot]?.video.id !== desired[slot]?.video.id) {
          slotPlaybackStatusRef.current[slot] = "loading";
          slotAudioAvailabilityRef.current[slot] = { videoId: desired[slot]?.video.id ?? null, availability: "unknown" };
        }
      }
      playerSlotsRef.current = desired;
      setPlayerSlots(desired);
    }
    if (activePlayerSlotRef.current !== promotedSlot) {
      activePlayerSlotRef.current = promotedSlot;
      setActivePlayerSlot(promotedSlot);
    }
    setActivePlaybackStatus(slotPlaybackStatusRef.current[promotedSlot]);
    const audioState = slotAudioAvailabilityRef.current[promotedSlot];
    setActiveAudioAvailability(audioState.videoId === active.video.id ? audioState.availability : "unknown");
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
    <MobileBottomNavigation slug={slug} context="reels"/>

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
                      <VideoPlayer key={slot} video={item.video} playbackUrl={item.playbackUrl} playbackType={item.playbackType} sourceHost={item.sourceHost} muted={!isActive || adPlaying} reelAudio controls={false} preloadOnly={!isActive} suspended={isActive && adPlaying} loadingPresentation="external" onPlaybackStarted={isActive ? onNormalPlaybackStarted : undefined} onPlaybackStatusChange={(videoId, status) => reportSlotPlaybackStatus(slot, videoId, status)} onAudioAvailabilityChange={(videoId, availability) => reportSlotAudioAvailability(slot, videoId, availability)}/>
                    {isActive && <div className={`reels-video-skeleton${activePlaybackStatus === "ready" ? " ready" : activePlaybackStatus === "error" ? " failed" : ""}`} aria-hidden="true"><div className="reels-skeleton-caption"><span className="reels-skeleton-title long"/><span className="reels-skeleton-title short"/><span className="reels-skeleton-views"/></div></div>}
                     {isActive && !adPlaying && <div className="reel-caption mobile-reel-caption"><h1>{item.video.title}</h1><PublicViewCount count={item.displayViews} className="reel-view-count"/></div>}
                    {isActive && activeAudioAvailability === "none" && <span className="reel-no-audio" role="img" aria-label="This video has no audio track"><VolumeX size={15}/></span>}
                 </div>;
                })}
                {adRequested && <VastAdPlayer start={adPlaying} index={adIndex} onReady={onAdReady} onFinish={onAdFinish}/>}
              </div>}
           </div>}
  </main>;
}
