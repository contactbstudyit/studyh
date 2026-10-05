"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clapperboard, Play, VolumeX } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { VideoPlayer } from "@/components/video-player";
import { ExoclickImageAd } from "@/components/exoclick-image-ad";
import MobileBottomNavigation from "@/components/mobile-bottom-navigation";
import type { VideoRecord } from "@/hooks/use-library";
import PublicViewCount from "@/components/public-view-count";
import type { VideoSourceType } from "@/lib/video-playback";

type ReelVideo = Omit<VideoRecord, "video_url" | "views" | "display_view_count" | "published_at" | "display_views">;
type ReelItem = { video: ReelVideo; playbackUrl: string; playbackType: VideoSourceType; sourceHost: string; displayViews: number };
type ReelResponse = { videos: ReelItem[]; page: number; pageSize: number; hasMore: boolean; error?: string };
type PlayerSlot = "a" | "b";
type PlayerSlots = Record<PlayerSlot, ReelItem | null>;
type ReelPlaybackStatus = "loading" | "ready" | "error";
type ReelAudioAvailability = "unknown" | "available" | "none";
type ReelAdPlacement = { id: string; afterVideoId: string; status: "pending" | "loading" | "served" };
type ReelFeedItem =
  | { kind: "reel"; key: string; feedIndex: number; videoIndex: number; item: ReelItem }
  | { kind: "ad"; key: string; feedIndex: number; ad: ReelAdPlacement };

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
  const [adPlacements, setAdPlacements] = useState<ReelAdPlacement[]>([]);
  const [activeAdId, setActiveAdId] = useState<string | null>(null);
  const [imageAdProviderReady, setImageAdProviderReady] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const videosRef = useRef(videos);
  const activeIndexRef = useRef(activeIndex);
  const playerSlotsRef = useRef(playerSlots);
  const activePlayerSlotRef = useRef(activePlayerSlot);
  const adPlacementsRef = useRef(adPlacements);
  const activeAdIdRef = useRef(activeAdId);
  const countedReelIdsRef = useRef(new Set<string>());
  const reelCountSinceAdRef = useRef(0);
  const nextAdThresholdRef = useRef(3 + Math.floor(Math.random() * 3));
  const adPlacementSequenceRef = useRef(0);
  const pendingAdIdRef = useRef<string | null>(null);
  const slotVideoElementsRef = useRef<Record<PlayerSlot, HTMLVideoElement | null>>({ a: null, b: null });
  const activeVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const pausedReelForAdRef = useRef<{ video: HTMLVideoElement; videoId: string; time: number; muted: boolean; volume: number; wasPlaying: boolean } | null>(null);
  const slotPlaybackStatusRef = useRef<Record<PlayerSlot, ReelPlaybackStatus>>({ a: "loading", b: "loading" });
  const slotAudioAvailabilityRef = useRef<Record<PlayerSlot, { videoId: string | null; availability: ReelAudioAvailability }>>({
    a: { videoId: null, availability: "unknown" },
    b: { videoId: null, availability: "unknown" },
  });
  videosRef.current = videos;
  activeIndexRef.current = activeIndex;
  playerSlotsRef.current = playerSlots;
  activePlayerSlotRef.current = activePlayerSlot;
  adPlacementsRef.current = adPlacements;
  activeAdIdRef.current = activeAdId;

  const setSlotVideoElement = useCallback((slot: PlayerSlot, element: HTMLVideoElement | null) => {
    slotVideoElementsRef.current[slot] = element;
    if (activePlayerSlotRef.current === slot) activeVideoElementRef.current = element;
  }, []);
  const setSlotAVideoElement = useCallback((element: HTMLVideoElement | null) => setSlotVideoElement("a", element), [setSlotVideoElement]);
  const setSlotBVideoElement = useCallback((element: HTMLVideoElement | null) => setSlotVideoElement("b", element), [setSlotVideoElement]);

  const updateAdPlacements = useCallback((next: ReelAdPlacement[]) => {
    adPlacementsRef.current = next;
    setAdPlacements(next);
  }, []);

  const restoreReelAfterAd = useCallback(() => {
    const paused = pausedReelForAdRef.current;
    if (!paused) return;
    pausedReelForAdRef.current = null;
    if (activeVideoElementRef.current !== paused.video || videosRef.current[activeIndexRef.current]?.video.id !== paused.videoId) return;
    try { paused.video.currentTime = paused.time; } catch { /* Keep the current position if the browser cannot seek yet. */ }
    paused.video.muted = paused.muted;
    paused.video.volume = paused.volume;
    if (paused.wasPlaying) void paused.video.play().catch(() => {});
  }, []);

  const skipAdPlacement = useCallback((adId: string, restoreReel = true) => {
    const current = adPlacementsRef.current.find((ad) => ad.id === adId);
    if (!current || current.status === "served") return;
    updateAdPlacements(adPlacementsRef.current.filter((ad) => ad.id !== adId));
    if (pendingAdIdRef.current === adId) pendingAdIdRef.current = null;
    if (activeAdIdRef.current === adId) {
      activeAdIdRef.current = null;
      setActiveAdId(null);
      if (restoreReel) restoreReelAfterAd();
    }
  }, [restoreReelAfterAd, updateAdPlacements]);

  const markAdFilled = useCallback((adId: string) => {
    const current = adPlacementsRef.current.find((ad) => ad.id === adId);
    if (!current || current.status === "served") return;
    updateAdPlacements(adPlacementsRef.current.map((ad) => ad.id === adId ? { ...ad, status: "served" } : ad));
    if (pendingAdIdRef.current === adId) pendingAdIdRef.current = null;
  }, [updateAdPlacements]);

  const onNormalReelPlaybackStarted = useCallback((videoId: string) => {
    if (mobileViewport !== true || countedReelIdsRef.current.has(videoId)) return;
    countedReelIdsRef.current.add(videoId);
    reelCountSinceAdRef.current += 1;
    if (reelCountSinceAdRef.current < nextAdThresholdRef.current || pendingAdIdRef.current) return;
    const videoIndex = videosRef.current.findIndex((item) => item.video.id === videoId);
    const currentVideo = videosRef.current[Math.max(videoIndex, activeIndexRef.current)] ?? videosRef.current[videoIndex];
    if (!currentVideo) return;
    const id = `exo-display-${++adPlacementSequenceRef.current}`;
    const next = [...adPlacementsRef.current, { id, afterVideoId: currentVideo.video.id, status: "pending" as const }];
    updateAdPlacements(next);
    pendingAdIdRef.current = id;
    reelCountSinceAdRef.current = 0;
    nextAdThresholdRef.current = 3 + Math.floor(Math.random() * 3);
  }, [mobileViewport, updateAdPlacements]);

  const activateAd = useCallback((adId: string) => {
    if (mobileViewport !== true || activeAdIdRef.current === adId) return;
    activeAdIdRef.current = adId;
    setActiveAdId(adId);
    const video = activeVideoElementRef.current;
    if (video && !video.paused) {
      pausedReelForAdRef.current = {
        video,
        videoId: videosRef.current[activeIndexRef.current]?.video.id ?? "",
        time: video.currentTime,
        muted: video.muted,
        volume: video.volume,
        wasPlaying: true,
      };
      video.pause();
    }
    const placement = adPlacementsRef.current.find((ad) => ad.id === adId);
    if (placement?.status === "pending") {
      updateAdPlacements(adPlacementsRef.current.map((ad) => ad.id === adId ? { ...ad, status: "loading" } : ad));
    }
  }, [mobileViewport, updateAdPlacements]);

  const feedItems = useMemo<ReelFeedItem[]>(() => {
    const byVideo = new Map<string, ReelAdPlacement[]>();
    if (mobileViewport === true) {
      for (const ad of adPlacements) byVideo.set(ad.afterVideoId, [...(byVideo.get(ad.afterVideoId) ?? []), ad]);
    }
    const feed: ReelFeedItem[] = [];
    for (let videoIndex = 0; videoIndex < videos.length; videoIndex += 1) {
      const item = videos[videoIndex];
      feed.push({ kind: "reel", key: `reel-${item.video.id}`, feedIndex: feed.length, videoIndex, item });
      for (const ad of byVideo.get(item.video.id) ?? []) feed.push({ kind: "ad", key: ad.id, feedIndex: feed.length, ad });
    }
    return feed;
  }, [adPlacements, mobileViewport, videos]);
  const reelFeedPositions = useMemo(() => {
    const positions = new Map<string, number>();
    for (const item of feedItems) if (item.kind === "reel") positions.set(item.item.video.id, item.feedIndex);
    return positions;
  }, [feedItems]);

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
      activeVideoElementRef.current = slotVideoElementsRef.current[promotedSlot];
      setActivePlaybackStatus(slotPlaybackStatusRef.current[promotedSlot]);
      const audioState = slotAudioAvailabilityRef.current[promotedSlot];
      setActiveAudioAvailability(audioState.videoId === target.video.id ? audioState.availability : "unknown");
    }

    if (index !== activeIndexRef.current) {
      activeIndexRef.current = index;
      setActiveIndex(index);
    }
  }, [mobileViewport]);

  const activateReelOrLeaveAd = useCallback((index: number) => {
    const leavingAdId = activeAdIdRef.current;
    if (leavingAdId) {
      const leavingAd = adPlacementsRef.current.find((ad) => ad.id === leavingAdId);
      if (leavingAd && leavingAd.status !== "served") skipAdPlacement(leavingAdId, false);
      else {
        activeAdIdRef.current = null;
        setActiveAdId(null);
      }
    }
    activateReel(index);
    restoreReelAfterAd();
  }, [activateReel, restoreReelAfterAd, skipAdPlacement]);

  const loadPage = useCallback(async (nextPage: number, replace = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError("");
    if (replace) {
      updateAdPlacements([]);
      pendingAdIdRef.current = null;
      activeAdIdRef.current = null;
      setActiveAdId(null);
      countedReelIdsRef.current.clear();
      reelCountSinceAdRef.current = 0;
      nextAdThresholdRef.current = 3 + Math.floor(Math.random() * 3);
      adPlacementSequenceRef.current = 0;
      pausedReelForAdRef.current = null;
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
      activeVideoElementRef.current = slotVideoElementsRef.current.a;
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
  }, [slug, updateAdPlacements]);

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
      if (mobileViewport === false) {
        if (adPlacementsRef.current.length > 0 || activeAdIdRef.current !== null) {
          updateAdPlacements([]);
          pendingAdIdRef.current = null;
          activeAdIdRef.current = null;
          setActiveAdId(null);
          pausedReelForAdRef.current = null;
        }
        if (reelCountSinceAdRef.current > 0 || countedReelIdsRef.current.size > 0) {
          reelCountSinceAdRef.current = 0;
          countedReelIdsRef.current.clear();
          nextAdThresholdRef.current = 3 + Math.floor(Math.random() * 3);
        }
      }
      if (mobileViewport === false && (playerSlotsRef.current.a || playerSlotsRef.current.b)) {
        playerSlotsRef.current = { a: null, b: null };
        setPlayerSlots({ a: null, b: null });
        activePlayerSlotRef.current = "a";
        activeVideoElementRef.current = slotVideoElementsRef.current.a;
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
    activeVideoElementRef.current = slotVideoElementsRef.current[promotedSlot];
    setActivePlaybackStatus(slotPlaybackStatusRef.current[promotedSlot]);
    const audioState = slotAudioAvailabilityRef.current[promotedSlot];
    setActiveAudioAvailability(audioState.videoId === active.video.id ? audioState.availability : "unknown");
  }, [activeIndex, mobileViewport, updateAdPlacements, videos]);

  useEffect(() => {
    const root = trackRef.current;
    if (!root || feedItems.length === 0) return;
    const observer = new IntersectionObserver(() => {
      const rootBounds = root.getBoundingClientRect();
      let visibleIndex = -1;
      let visibleRatio = 0;
      let visibleSlide: HTMLElement | null = null;
      root.querySelectorAll<HTMLElement>("[data-feed-index]").forEach((slide) => {
        const rect = slide.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(rect.bottom, rootBounds.bottom) - Math.max(rect.top, rootBounds.top));
        const ratio = rect.height > 0 ? visibleHeight / rect.height : 0;
        if (ratio > visibleRatio) {
          visibleRatio = ratio;
          visibleSlide = slide;
          visibleIndex = Number(slide.dataset.feedIndex);
        }
      });
      if (visibleRatio < 0.6 || !Number.isInteger(visibleIndex) || !visibleSlide) return;
      const activeSlide = visibleSlide as HTMLElement;
      if (activeSlide.dataset.feedType === "ad" && activeSlide.dataset.adId) {
        activateAd(activeSlide.dataset.adId);
      } else {
        const videoIndex = Number(activeSlide.dataset.reelIndex);
        if (Number.isInteger(videoIndex)) activateReelOrLeaveAd(videoIndex);
      }
    }, { root, threshold: [0.6, 0.8] });
    root.querySelectorAll<HTMLElement>("[data-feed-index]").forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, [activateAd, activateReelOrLeaveAd, feedItems]);

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
              {mobileViewport === true && activeAdId && <Script id="exoclick-display-zone-6047522" src="https://a.magsrv.com/ad-provider.js" async type="application/javascript" strategy="afterInteractive" onReady={() => setImageAdProviderReady(true)} onError={() => skipAdPlacement(activeAdId)}/>}
              {feedItems.map((feedItem) => {
                if (feedItem.kind === "ad") {
                  const isActiveAd = activeAdId === feedItem.ad.id;
                  const keepRendered = isActiveAd || feedItem.ad.status === "served";
                  return <article className="reel-slide reel-ad-slide" data-feed-index={feedItem.feedIndex} data-feed-type="ad" data-ad-id={feedItem.ad.id} key={feedItem.key} aria-label="Advertisement">
                    <div className="reel-image-ad-card">
                      <span className="reel-image-ad-label">Advertisement</span>
                      {keepRendered
                        ? <ExoclickImageAd slotId={feedItem.ad.id} active={isActiveAd} providerReady={imageAdProviderReady} onFilled={markAdFilled} onNoFill={skipAdPlacement}/>
                        : <div className="exo-display-frame" aria-hidden="true"><div className="exo-display-skeleton"/></div>}
                    </div>
                  </article>;
                }

                const { item, videoIndex, feedIndex } = feedItem;
                const desktopActive = mobileViewport === false && activeIndex === videoIndex;
                return <article className="reel-slide" data-feed-index={feedIndex} data-feed-type="reel" data-reel-index={videoIndex} key={feedItem.key} aria-label={`Video ${videoIndex + 1}: ${item.video.title}`}>
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
              {mobileViewport === true && <div className="reels-player-layer" aria-label="Active Reel playback" style={{ height: `${feedItems.length * 100}dvh` }}>
               {(["a", "b"] as const).map((slot) => {
                 const item = playerSlots[slot];
                 if (!item) return null;
                 const isActive = slot === activePlayerSlot;
                   const slotIndex = reelFeedPositions.get(item.video.id) ?? 0;
                   return <div className={`reel-player-slot ${isActive ? "active" : "preparing"}`} aria-hidden={!isActive} key={slot} style={{ top: `${Math.max(0, slotIndex) * 100}dvh` }}>
                       <VideoPlayer key={slot} video={item.video} playbackUrl={item.playbackUrl} playbackType={item.playbackType} sourceHost={item.sourceHost} muted={!isActive} reelAudio controls={false} preloadOnly={!isActive} loadingPresentation="external" onVideoElement={slot === "a" ? setSlotAVideoElement : setSlotBVideoElement} onPlaybackStarted={isActive ? onNormalReelPlaybackStarted : undefined} onPlaybackStatusChange={(videoId, status) => reportSlotPlaybackStatus(slot, videoId, status)} onAudioAvailabilityChange={(videoId, availability) => reportSlotAudioAvailability(slot, videoId, availability)}/>
                    {isActive && <div className={`reels-video-skeleton${activePlaybackStatus === "ready" ? " ready" : activePlaybackStatus === "error" ? " failed" : ""}`} aria-hidden="true"><div className="reels-skeleton-caption"><span className="reels-skeleton-title long"/><span className="reels-skeleton-title short"/><span className="reels-skeleton-views"/></div></div>}
                     {isActive && <div className="reel-caption mobile-reel-caption"><h1>{item.video.title}</h1><PublicViewCount count={item.displayViews} className="reel-view-count"/></div>}
                    {isActive && activeAudioAvailability === "none" && <span className="reel-no-audio" role="img" aria-label="This video has no audio track"><VolumeX size={15}/></span>}
                 </div>;
                })}
              </div>}
           </div>}
  </main>;
}
