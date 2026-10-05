"use client";

import { useEffect, useRef, useState } from "react";

const VAST_TAG = "https://spitefulmom.com/d.mbFwzsdeG/N/vKZlGzUP/Iecm-9nuaZ/UTlmkMPvTgcK0DOoDzkhxjOLDmkKttNXzKQS4/OAT/E-5tMdwS";
const IMA_SCRIPT = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";

type ImaManager = {
  init: (width: number, height: number, mode: unknown) => void;
  start: () => void;
  destroy: () => void;
  addEventListener: (event: unknown, callback: () => void) => void;
};
type ImaNamespace = {
  AdDisplayContainer: new (container: HTMLElement, video: HTMLVideoElement) => { initialize: () => void; destroy: () => void };
  AdsLoader: new (display: unknown) => { addEventListener: (event: unknown, callback: (event: { getAdsManager: (video: HTMLVideoElement) => ImaManager }) => void) => void; requestAds: (request: unknown) => void; contentComplete: () => void; destroy: () => void };
  AdsRequest: new () => { adTagUrl: string; linearAdSlotWidth: number; linearAdSlotHeight: number; nonLinearAdSlotWidth: number; nonLinearAdSlotHeight: number; vastLoadTimeout: number; setAdWillPlayMuted: (value: boolean) => void };
  AdEvent: { Type: Record<string, unknown> };
  AdsManagerLoadedEvent: { Type: Record<string, unknown> };
  AdErrorEvent: { Type: Record<string, unknown> };
  ViewMode: { NORMAL: unknown };
};

declare global { interface Window { google?: { ima?: ImaNamespace }; __imaScriptPromise?: Promise<void> } }

function loadImaSdk() {
  if (window.google?.ima) return Promise.resolve();
  if (window.__imaScriptPromise) return window.__imaScriptPromise;
  window.__imaScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = IMA_SCRIPT;
    script.async = true;
    script.onload = () => window.google?.ima ? resolve() : reject(new Error("IMA SDK unavailable"));
    script.onerror = () => reject(new Error("IMA SDK failed to load"));
    document.head.appendChild(script);
  });
  return window.__imaScriptPromise;
}

export function VastAdPlayer({ start, index, onReady, onFinish }: { start: boolean; index: number | null; onReady: () => void; onFinish: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "playing">("loading");
  const startRef = useRef(start);
  const beginRef = useRef<() => void>(() => {});
  startRef.current = start;

  useEffect(() => {
    let alive = true;
    let initialized = false;
    let finished = false;
    let began = false;
    let playing = false;
    let manager: ImaManager | null = null;
    let loader: InstanceType<ImaNamespace["AdsLoader"]> | null = null;
    let display: { initialize: () => void; destroy: () => void } | null = null;
    const finish = () => { if (!alive || finished) return; finished = true; onFinish(); };
    const initOnGesture = () => {
      if (initialized || !display) return;
      try { display.initialize(); initialized = true; } catch { /* SDK retries initialization on a later gesture. */ }
    };
    document.addEventListener("pointerdown", initOnGesture, true);
    document.addEventListener("keydown", initOnGesture, true);
    const timeout = window.setTimeout(finish, 5500);

    void loadImaSdk().then(() => {
      if (!alive || !containerRef.current || !videoRef.current) return;
      const ima = window.google?.ima;
      if (!ima) throw new Error("IMA SDK unavailable");
      display = new ima.AdDisplayContainer(containerRef.current, videoRef.current);
      loader = new ima.AdsLoader(display);
      loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event) => {
        if (!alive) return;
        manager = event.getAdsManager(videoRef.current!);
        const events = ima.AdEvent.Type;
        const onStart = () => { if (!alive) return; playing = true; window.clearTimeout(timeout); setStatus("playing"); };
        manager.addEventListener(events.STARTED, onStart);
        for (const key of ["COMPLETE", "SKIPPED", "ALL_ADS_COMPLETED", "CONTENT_RESUME_REQUESTED"]) manager.addEventListener(events[key], finish);
        manager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, finish);
        setStatus("ready"); onReady();
        if (startRef.current) beginRef.current();
      });
      loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, finish);
      const request = new ima.AdsRequest();
      request.adTagUrl = VAST_TAG;
      request.linearAdSlotWidth = Math.max(320, window.innerWidth);
      request.linearAdSlotHeight = Math.max(400, window.innerHeight - 68);
      request.nonLinearAdSlotWidth = request.linearAdSlotWidth;
      request.nonLinearAdSlotHeight = Math.floor(request.linearAdSlotHeight / 3);
      request.vastLoadTimeout = 3500;
      request.setAdWillPlayMuted(false);
      loader.requestAds(request);
    }).catch(finish);

    function begin() {
      if (!alive || !manager || finished || began) return;
      began = true;
      try {
        initOnGesture();
        manager.init(Math.max(320, window.innerWidth), Math.max(400, window.innerHeight - 68), window.google!.ima!.ViewMode.NORMAL);
        manager.start();
        window.setTimeout(() => { if (alive && !finished && !playing) finish(); }, 2500);
      } catch { finish(); }
    }
    beginRef.current = begin;

    return () => {
      alive = false;
      window.clearTimeout(timeout);
      document.removeEventListener("pointerdown", initOnGesture, true);
      document.removeEventListener("keydown", initOnGesture, true);
      try { manager?.destroy(); } catch { /* Ignore SDK teardown failures. */ }
      try { loader?.destroy(); } catch { /* Ignore SDK teardown failures. */ }
      try { display?.destroy(); } catch { /* Ignore SDK teardown failures. */ }
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.removeAttribute("src"); videoRef.current.load(); }
    };
  }, [onFinish, onReady]);

  useEffect(() => {
    if (start && status === "ready") beginRef.current();
  }, [start, status]);

  return <div ref={containerRef} className={`vast-ad-player${start ? " active" : ""}`} style={{ top: `${Math.max(0, index ?? 0) * 100}dvh` }} aria-label="Advertisement">
    <video ref={videoRef} playsInline muted={false}/>
    {start && status !== "playing" && <div className="vast-ad-loading" role="status"><span className="spinner"/><span>Advertisement</span></div>}
    <span className="vast-ad-label">Advertisement</span>
  </div>;
}
