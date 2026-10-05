"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent, RefObject } from "react";
import { Play } from "lucide-react";

const IMA_SCRIPT_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
const FREQUENCY_KEY = "exoclick-video-ad-opportunity-at";
const FREQUENCY_WINDOW_MS = 60 * 60 * 1000;

type ImaError = { getErrorCode?: () => number; getMessage?: () => string };
type ImaEvent = { getAdsManager?: (video: HTMLVideoElement) => ImaManager; getError?: () => ImaError };
type ImaManager = {
  init: (width: number, height: number, mode: unknown) => void;
  start: () => void;
  destroy: () => void;
  addEventListener: (event: unknown, callback: (event?: ImaEvent) => void) => void;
  removeEventListener: (event: unknown, callback: (event?: ImaEvent) => void) => void;
};
type ImaLoader = {
  addEventListener: (event: unknown, callback: (event?: ImaEvent) => void) => void;
  removeEventListener: (event: unknown, callback: (event?: ImaEvent) => void) => void;
  requestAds: (request: unknown) => void;
  destroy: () => void;
};
type ImaDisplay = { initialize: () => void; destroy: () => void };
type ImaRequest = {
  adTagUrl: string;
  linearAdSlotWidth: number;
  linearAdSlotHeight: number;
  nonLinearAdSlotWidth: number;
  nonLinearAdSlotHeight: number;
  vastLoadTimeout: number;
  setAdWillPlayMuted: (muted: boolean) => void;
};
type ImaNamespace = {
  AdDisplayContainer: new (container: HTMLElement, video: HTMLVideoElement) => ImaDisplay;
  AdsLoader: new (display: ImaDisplay) => ImaLoader;
  AdsRequest: new () => ImaRequest;
  AdEvent: { Type: Record<string, unknown> };
  AdsManagerLoadedEvent: { Type: Record<string, unknown> };
  AdErrorEvent: { Type: Record<string, unknown> };
  ViewMode: { NORMAL: unknown };
};

declare global {
  interface Window {
    google?: { ima?: ImaNamespace };
    __exoImaSdkPromise?: Promise<ImaNamespace>;
  }
}

type BoundListener = { target: ImaLoader | ImaManager; type: unknown; callback: (event?: ImaEvent) => void };
type ContentSnapshot = { time: number; muted: boolean; volume: number; wasPlaying: boolean };
type AdSession = {
  display: ImaDisplay;
  loader: ImaLoader;
  manager?: ImaManager;
  listeners: BoundListener[];
  timeout?: number;
  startTimeout?: number;
  snapshot?: ContentSnapshot;
  ended: boolean;
};

function loadImaSdk(): Promise<ImaNamespace> {
  const existing = window.google?.ima;
  if (existing) return Promise.resolve(existing);
  if (window.__exoImaSdkPromise) return window.__exoImaSdkPromise;
  window.__exoImaSdkPromise = new Promise<ImaNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = IMA_SCRIPT_URL;
    script.async = true;
    script.onload = () => window.google?.ima ? resolve(window.google.ima) : reject(new Error("IMA SDK unavailable"));
    script.onerror = () => reject(new Error("IMA SDK failed to load"));
    document.head.appendChild(script);
  });
  return window.__exoImaSdkPromise;
}

function hasRecentOpportunity() {
  try {
    const lastOpportunity = Number(window.localStorage.getItem(FREQUENCY_KEY));
    return Number.isFinite(lastOpportunity) && lastOpportunity > 0 && Date.now() - lastOpportunity < FREQUENCY_WINDOW_MS;
  } catch {
    return false;
  }
}

export function ExoclickVastAd({ contentVideoRef, enabled, videoId }: {
  contentVideoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  videoId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<AdSession | null>(null);
  const cancelRef = useRef<((resumeContent: boolean) => void) | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [adVisible, setAdVisible] = useState(false);

  useEffect(() => {
    let active = true;
    setSdkReady(false);
    setEligible(false);
    if (!enabled || hasRecentOpportunity()) return () => { active = false; };
    setEligible(true);
    void loadImaSdk().then(() => { if (active) setSdkReady(true); }).catch(() => {});
    return () => {
      active = false;
      cancelRef.current?.(false);
      cancelRef.current = null;
      setSdkReady(false);
      setEligible(false);
    };
  }, [enabled, videoId]);

  function startAdFromPlayClick(event: MouseEvent<HTMLButtonElement>) {
    if (!event.nativeEvent.isTrusted) return;
    const contentVideo = contentVideoRef.current;
    const adContainer = containerRef.current;
    const ima = window.google?.ima;
    if (!enabled || !sdkReady || !eligible || !contentVideo || !adContainer || !ima || sessionRef.current || hasRecentOpportunity()) return;

    setEligible(false);
    setRequesting(true);
    try { window.localStorage.setItem(FREQUENCY_KEY, String(Date.now())); } catch { /* Per-session duplicate prevention still applies. */ }

    let display: ImaDisplay;
    let loader: ImaLoader;
    try {
      display = new ima.AdDisplayContainer(adContainer, contentVideo);
      display.initialize();
      loader = new ima.AdsLoader(display);
    } catch {
      setRequesting(false);
      return;
    }

    const session: AdSession = { display, loader, listeners: [], ended: false };
    sessionRef.current = session;

    const listen = (target: ImaLoader | ImaManager, type: unknown, callback: (event?: ImaEvent) => void) => {
      target.addEventListener(type, callback);
      session.listeners.push({ target, type, callback });
    };

    const finish = (resumeContent: boolean) => {
      if (session.ended) return;
      session.ended = true;
      if (session.timeout) window.clearTimeout(session.timeout);
      if (session.startTimeout) window.clearTimeout(session.startTimeout);
      for (const listener of session.listeners) listener.target.removeEventListener(listener.type, listener.callback);
      try { session.manager?.destroy(); } catch { /* Ignore SDK teardown errors. */ }
      try { session.loader.destroy(); } catch { /* Ignore SDK teardown errors. */ }
      try { session.display.destroy(); } catch { /* Ignore SDK teardown errors. */ }
      if (sessionRef.current === session) sessionRef.current = null;
      setRequesting(false);
      setAdVisible(false);
      if (resumeContent && session.snapshot) {
        const video = contentVideoRef.current;
        if (video) {
          try { video.currentTime = session.snapshot.time; } catch { /* Keep the current position if seeking is unavailable. */ }
          video.muted = session.snapshot.muted;
          video.volume = session.snapshot.volume;
          if (session.snapshot.wasPlaying) void video.play().catch(() => {});
        }
      }
    };
    cancelRef.current = finish;

    const events = ima.AdEvent.Type;
    const errors = ima.AdErrorEvent.Type;
    const loadedEvent = ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED;
    listen(loader, loadedEvent, (event) => {
      if (session.ended || !event?.getAdsManager) return;
      try {
        session.manager = event.getAdsManager(contentVideo);
        const rect = adContainer.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        session.snapshot = { time: contentVideo.currentTime, muted: contentVideo.muted, volume: contentVideo.volume, wasPlaying: !contentVideo.paused && !contentVideo.ended };
        contentVideo.pause();
        setAdVisible(true);
        const manager = session.manager;
        listen(manager, events.STARTED, () => {
          if (session.startTimeout) window.clearTimeout(session.startTimeout);
        });
        for (const eventType of [events.COMPLETE, events.SKIPPED, events.ALL_ADS_COMPLETED, events.CONTENT_RESUME_REQUESTED]) {
          listen(manager, eventType, () => finish(true));
        }
        listen(manager, errors.AD_ERROR, () => finish(true));
        session.startTimeout = window.setTimeout(() => finish(true), 10000);
        manager.init(width, height, ima.ViewMode.NORMAL);
        manager.start();
      } catch {
        finish(true);
      }
    });
    listen(loader, errors.AD_ERROR, () => finish(true));
    session.timeout = window.setTimeout(() => finish(true), 15000);

    const request = new ima.AdsRequest();
    request.adTagUrl = new URL("/api/ads/exoclick-vast", window.location.origin).toString();
    const rect = adContainer.getBoundingClientRect();
    request.linearAdSlotWidth = Math.max(1, Math.round(rect.width));
    request.linearAdSlotHeight = Math.max(1, Math.round(rect.height));
    request.nonLinearAdSlotWidth = request.linearAdSlotWidth;
    request.nonLinearAdSlotHeight = Math.max(1, Math.round(rect.height / 3));
    request.vastLoadTimeout = 10000;
    request.setAdWillPlayMuted(false);
    try { loader.requestAds(request); } catch { finish(true); }
  }

  return <>
    <div ref={containerRef} className={`exoclick-ad-surface${adVisible ? " active" : ""}`} aria-hidden={!adVisible}/>
    {enabled && sdkReady && eligible && !requesting && <button className="exoclick-play-ad" type="button" onClick={startAdFromPlayClick} aria-label="Play advertisement">
      <Play size={13} fill="currentColor"/><span>Play ad</span>
    </button>}
    {requesting && adVisible && <span className="exoclick-ad-label">Advertisement</span>}
  </>;
}
