"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

const IMA_SCRIPT_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
const FREQUENCY_KEY = "exoclick-watch-video-ad-opportunity-at";
const FREQUENCY_WINDOW_MS = 60 * 60 * 1000;

type ImaError = { getErrorCode?: () => number; getMessage?: () => string };
type ImaEvent = { getAdsManager?: (video: HTMLVideoElement) => ImaManager; getError?: () => ImaError };
type ImaManager = {
  init: (width: number, height: number, mode: unknown) => void;
  start: () => void;
  setVolume: (volume: number) => void;
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
type ContentSnapshot = { time: number; muted: boolean; volume: number };
type AdSession = {
  display?: ImaDisplay;
  loader?: ImaLoader;
  manager?: ImaManager;
  listeners: BoundListener[];
  timeout?: number;
  startTimeout?: number;
  playbackTimeout?: number;
  snapshot: ContentSnapshot;
  ended: boolean;
};

function loadImaSdk(): Promise<ImaNamespace> {
  if (window.google?.ima) return Promise.resolve(window.google.ima);
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

export function ExoclickVastAd({ contentVideoRef, videoId }: {
  contentVideoRef: RefObject<HTMLVideoElement | null>;
  videoId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<AdSession | null>(null);
  const allowProgrammaticPlayRef = useRef(false);
  const [adActive, setAdActive] = useState(false);

  useEffect(() => {
    const video = contentVideoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;

    let mounted = true;
    let session: AdSession | null = null;

    const finish = (current: AdSession, resumeContent: boolean) => {
      if (current.ended) return;
      current.ended = true;
      if (current.timeout) window.clearTimeout(current.timeout);
      if (current.startTimeout) window.clearTimeout(current.startTimeout);
      if (current.playbackTimeout) window.clearTimeout(current.playbackTimeout);
      for (const listener of current.listeners) listener.target.removeEventListener(listener.type, listener.callback);
      try { current.manager?.destroy(); } catch { /* Ignore IMA teardown errors. */ }
      try { current.loader?.destroy(); } catch { /* Ignore IMA teardown errors. */ }
      try { current.display?.destroy(); } catch { /* Ignore IMA teardown errors. */ }
      if (sessionRef.current === current) sessionRef.current = null;
      if (session === current) session = null;
      setAdActive(false);
      if (!resumeContent) return;
      const content = contentVideoRef.current;
      if (!content) return;
      try { content.currentTime = current.snapshot.time; } catch { /* Keep the current position if seeking is unavailable. */ }
      content.muted = current.snapshot.muted;
      content.volume = current.snapshot.volume;
      allowProgrammaticPlayRef.current = true;
      void content.play().catch(() => { allowProgrammaticPlayRef.current = false; });
    };

    const beginRequest = (current: AdSession, ima: ImaNamespace) => {
      if (!mounted || current.ended || !video.isConnected) { finish(current, false); return; }
      try {
        current.display = new ima.AdDisplayContainer(container, video);
        current.display.initialize();
        current.loader = new ima.AdsLoader(current.display);
      } catch {
        finish(current, true);
        return;
      }

      const listen = (target: ImaLoader | ImaManager, type: unknown, callback: (event?: ImaEvent) => void) => {
        target.addEventListener(type, callback);
        current.listeners.push({ target, type, callback });
      };
      const loader = current.loader;
      const events = ima.AdEvent.Type;
      const errors = ima.AdErrorEvent.Type;

      listen(loader, ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event) => {
        if (current.ended || !event?.getAdsManager) return;
        try {
          current.manager = event.getAdsManager(video);
          if (current.timeout) window.clearTimeout(current.timeout);
          current.timeout = undefined;
          const manager = current.manager;
          const rect = container.getBoundingClientRect();
          const width = Math.max(1, Math.round(rect.width));
          const height = Math.max(1, Math.round(rect.height));
          setAdActive(true);
          manager.setVolume(current.snapshot.muted ? 0 : current.snapshot.volume);
          listen(manager, events.STARTED, () => {
            if (current.startTimeout) window.clearTimeout(current.startTimeout);
            current.playbackTimeout = window.setTimeout(() => finish(current, true), 300000);
          });
          for (const eventType of [events.COMPLETE, events.SKIPPED, events.ALL_ADS_COMPLETED, events.CONTENT_RESUME_REQUESTED]) {
            listen(manager, eventType, () => finish(current, true));
          }
          listen(manager, errors.AD_ERROR, () => finish(current, true));
          current.startTimeout = window.setTimeout(() => finish(current, true), 12000);
          manager.init(width, height, ima.ViewMode.NORMAL);
          manager.start();
        } catch {
          finish(current, true);
        }
      });
      listen(loader, errors.AD_ERROR, () => finish(current, true));
      if (current.timeout) window.clearTimeout(current.timeout);
      current.timeout = window.setTimeout(() => finish(current, true), 10000);

      const request = new ima.AdsRequest();
      request.adTagUrl = new URL("/api/ads/exoclick-vast", window.location.origin).toString();
      request.linearAdSlotWidth = Math.max(1, Math.round(container.clientWidth));
      request.linearAdSlotHeight = Math.max(1, Math.round(container.clientHeight));
      request.nonLinearAdSlotWidth = request.linearAdSlotWidth;
      request.nonLinearAdSlotHeight = Math.max(1, Math.round(container.clientHeight / 3));
      request.vastLoadTimeout = 7000;
      request.setAdWillPlayMuted(current.snapshot.muted);
      try { loader.requestAds(request); } catch { finish(current, true); }
    };

    const onPlay = (event: Event) => {
      if (allowProgrammaticPlayRef.current) { allowProgrammaticPlayRef.current = false; return; }
      if (!event.isTrusted) return;
      if (sessionRef.current) { video.pause(); return; }
      if (hasRecentOpportunity()) return;

      const current: AdSession = {
        listeners: [],
        snapshot: { time: video.currentTime, muted: video.muted, volume: video.volume },
        ended: false,
      };
      session = current;
      sessionRef.current = current;
      current.timeout = window.setTimeout(() => finish(current, true), 15000);
      video.pause();
      try { window.localStorage.setItem(FREQUENCY_KEY, String(Date.now())); } catch { /* Prevent duplicate requests in this player session. */ }

      const ima = window.google?.ima;
      if (ima) beginRequest(current, ima);
      else void loadImaSdk().then((loadedIma) => beginRequest(current, loadedIma)).catch(() => finish(current, true));
    };

    video.addEventListener("play", onPlay);
    void loadImaSdk().catch(() => {});

    return () => {
      mounted = false;
      video.removeEventListener("play", onPlay);
      if (session) finish(session, false);
    };
  }, [contentVideoRef, videoId]);

  return <>
    <div ref={containerRef} className={`exoclick-ad-surface${adActive ? " active" : ""}`} aria-hidden={!adActive}/>
    {adActive && <span className="exoclick-ad-label">Advertisement</span>}
  </>;
}
