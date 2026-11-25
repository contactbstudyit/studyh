"use client";

import { useEffect, useRef, useState } from "react";
import { ExoclickImageAd } from "@/components/exoclick-image-ad";

const IMA_SCRIPT_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
const VIDEO_TAG_URL = "/api/ads/exoclick-vast";

type ReelImaManager = {
  init: (width: number, height: number, mode: unknown) => void;
  start: () => void;
  setVolume?: (volume: number) => void;
  destroy: () => void;
  addEventListener: (event: unknown, callback: () => void) => void;
};
type ReelImaLoader = {
  requestAds: (request: unknown) => void;
  destroy: () => void;
  addEventListener: (event: unknown, callback: (event?: { getAdsManager?: () => ReelImaManager }) => void) => void;
};
type ReelImaNamespace = {
  AdDisplayContainer: new (container: HTMLElement, video: HTMLVideoElement) => { initialize: () => void; destroy: () => void };
  AdsLoader: new (display: { initialize: () => void; destroy: () => void }) => ReelImaLoader;
  AdsRequest: new () => { adTagUrl: string; linearAdSlotWidth: number; linearAdSlotHeight: number; setAdWillPlayMuted: (muted: boolean) => void };
  AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: unknown } };
  AdErrorEvent: { Type: { AD_ERROR: unknown } };
  AdEvent: { Type: { STARTED: unknown; COMPLETE: unknown; ALL_ADS_COMPLETED: unknown; CONTENT_RESUME_REQUESTED: unknown } };
  ViewMode: { NORMAL: unknown };
};

declare global {
  interface Window {
    __exoReelImaSdkPromise?: Promise<ReelImaNamespace>;
  }
}

function loadIma(): Promise<ReelImaNamespace> {
  const existingIma = window.google?.ima as unknown as ReelImaNamespace | undefined;
  if (existingIma) return Promise.resolve(existingIma);
  if (window.__exoReelImaSdkPromise) return window.__exoReelImaSdkPromise;
  window.__exoReelImaSdkPromise = new Promise<ReelImaNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = IMA_SCRIPT_URL;
    script.async = true;
    script.onload = () => window.google?.ima ? resolve(window.google.ima as unknown as ReelImaNamespace) : reject(new Error("IMA unavailable"));
    script.onerror = () => reject(new Error("IMA failed to load"));
    document.head.appendChild(script);
  });
  return window.__exoReelImaSdkPromise;
}

export function ExoclickReelVideoAd({ slotId, active, prepare = false, fallbackProviderReady, fallbackProviderFailed, onFilled, onNoFill }: {
  slotId: string;
  active: boolean;
  prepare?: boolean;
  fallbackProviderReady: boolean;
  fallbackProviderFailed: boolean;
  onFilled: (slotId: string) => void;
  onNoFill: (slotId: string) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<{ manager?: ReelImaManager; loader?: ReelImaLoader; display?: { destroy: () => void }; ended: boolean; started: boolean } | null>(null);
  const activeRef = useRef(active);
  const startAdRef = useRef<() => void>(() => {});
  const [fallback, setFallback] = useState(false);
  const [started, setStarted] = useState(false);
  activeRef.current = active;

  useEffect(() => {
    if ((!active && !prepare) || fallback || sessionRef.current) return;
    const surface = surfaceRef.current;
    const video = videoRef.current;
    if (!surface || !video) return;
    let mounted = true;
    let timeout: number | undefined;
    const finish = (filled: boolean) => {
      const session = sessionRef.current;
      if (session?.ended) return;
      if (session) session.ended = true;
      if (timeout) window.clearTimeout(timeout);
      try { session?.manager?.destroy(); } catch { /* Provider teardown is best effort. */ }
      try { session?.loader?.destroy(); } catch { /* Provider teardown is best effort. */ }
      try { session?.display?.destroy(); } catch { /* Provider teardown is best effort. */ }
      sessionRef.current = null;
      if (!mounted) return;
      if (filled) onFilled(slotId);
      else setFallback(true);
    };
    const begin = (ima: ReelImaNamespace) => {
      if (!mounted) return;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      const display = new ima.AdDisplayContainer(surface, video);
      display.initialize();
      const loader = new ima.AdsLoader(display);
      const session: { display: typeof display; loader: ReelImaLoader; manager?: ReelImaManager; ended: boolean; started: boolean } = { display, loader, ended: false, started: false };
      sessionRef.current = session;
      loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event) => {
        if (!event?.getAdsManager || session.ended) return;
        const manager = event.getAdsManager();
        session.manager = manager;
        const startAd = () => {
          if (session.ended || session.started) return;
          session.started = true;
          manager.init(surface.clientWidth, surface.clientHeight, ima.ViewMode.NORMAL);
          manager.setVolume?.(0);
          video.muted = true;
          manager.start();
          void video.play().catch(() => { /* Muted autoplay can still be blocked until a Reel gesture. */ });
        };
        startAdRef.current = startAd;
        manager.addEventListener(ima.AdEvent.Type.STARTED, () => {
          video.muted = true;
          manager.setVolume?.(0);
          setStarted(true);
          onFilled(slotId);
          void video.play().catch(() => { /* The muted Reel autoplay path remains available after the first Reel gesture. */ });
        });
        manager.addEventListener(ima.AdEvent.Type.COMPLETE, () => finish(true));
        manager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, () => finish(true));
        manager.addEventListener(ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => finish(true));
        if (activeRef.current) startAd();
      });
      loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, () => finish(false));
      const request = new ima.AdsRequest();
      request.linearAdSlotWidth = Math.max(1, surface.clientWidth);
      request.linearAdSlotHeight = Math.max(1, surface.clientHeight);
      request.setAdWillPlayMuted(true);
      void fetch(new URL(VIDEO_TAG_URL, window.location.origin), { cache: "no-store", credentials: "omit" }).then(async (response) => {
        if (!response.ok) throw new Error(`Video tag configuration returned HTTP ${response.status}`);
        const config = await response.json() as { adTagUrl?: string };
        const tag = new URL(config.adTagUrl ?? "");
        if (tag.protocol !== "https:" || tag.hostname !== "s.magsrv.com" || tag.pathname !== "/v1/vast.php" || tag.searchParams.get("idzone") !== "6047418") throw new Error("Invalid ExoClick video tag");
        request.adTagUrl = tag.toString();
        loader.requestAds(request);
      }).catch(() => finish(false));
      timeout = window.setTimeout(() => finish(false), 12000);
    };
    void loadIma().then(begin).catch(() => finish(false));
    return () => {
      mounted = false;
      if (activeRef.current === active) finish(false);
    };
  }, [active, fallback, onFilled, prepare, slotId]);

  useEffect(() => {
    if (active) startAdRef.current();
  }, [active]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) video.pause();
    else if (sessionRef.current) void video.play().catch(() => {});
  }, [active]);

  if (fallback) return <ExoclickImageAd slotId={slotId} request active={active} providerReady={fallbackProviderReady} providerFailed={fallbackProviderFailed} onFilled={onFilled} onNoFill={onNoFill}/>;
  return <div ref={surfaceRef} className="exo-reel-video-ad-surface" onClick={() => { const video = videoRef.current; if (video) { video.muted = true; void video.play().catch(() => {}); } }}>
    <video ref={videoRef} className="exo-reel-video-ad-video" muted autoPlay playsInline aria-label="Advertisement"/>
    {!started && <span className="reel-image-ad-label">Advertisement</span>}
  </div>;
}
