"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    AdProvider?: Array<{ serve: Record<string, never> }>;
  }
}

export function ExoclickImageAd({ slotId, request, providerReady, providerFailed, onFilled, onNoFill }: {
  slotId: string;
  request: boolean;
  providerReady: boolean;
  providerFailed: boolean;
  onFilled: (slotId: string) => void;
  onNoFill: (slotId: string) => void;
}) {
  const insRef = useRef<HTMLModElement>(null);
  const submittedRef = useRef(false);
  const settledRef = useRef(false);
  const observedCreativeNodesRef = useRef(new WeakSet<Element>());
  const loadedCreativeNodesRef = useRef(new WeakSet<Element>());
  const [filled, setFilled] = useState(false);
  const [creativeSize, setCreativeSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!request || filled) return;
    if (providerFailed) {
      if (!settledRef.current) { settledRef.current = true; onNoFill(slotId); }
      return;
    }
    const timeout = window.setTimeout(() => {
      if (settledRef.current) return;
      settledRef.current = true;
      onNoFill(slotId);
    }, 12000);
    return () => window.clearTimeout(timeout);
  }, [filled, onNoFill, providerFailed, request, slotId]);

  useEffect(() => {
    const ins = insRef.current;
    if (!request || providerFailed || !providerReady || !ins || submittedRef.current) return;
    submittedRef.current = true;
    const startedAt = performance.now();

    let observer: MutationObserver | null = null;
    const failCreative = () => {
      if (!request) return;
      if (settledRef.current && filled) {
        setFilled(false);
        setCreativeSize(null);
      }
      if (settledRef.current && !filled) return;
      settledRef.current = true;
      onNoFill(slotId);
    };
    const detectCreative = () => {
      if (settledRef.current) return;
      const media = ins.querySelector<HTMLElement>("iframe, img, video, object, embed");
      if (!media) return;
      if (!observedCreativeNodesRef.current.has(media)) {
        observedCreativeNodesRef.current.add(media);
        const markLoaded = () => { loadedCreativeNodesRef.current.add(media); detectCreative(); };
        for (const eventName of media instanceof HTMLVideoElement ? ["loadedmetadata", "loadeddata", "canplay"] : ["load", "loadeddata"]) {
          media.addEventListener(eventName, markLoaded);
        }
        media.addEventListener("error", failCreative, { once: true });
      }
      const bounds = media.getBoundingClientRect();
      const intrinsicWidth = media instanceof HTMLImageElement ? media.naturalWidth : media instanceof HTMLVideoElement ? media.videoWidth : 0;
      const intrinsicHeight = media instanceof HTMLImageElement ? media.naturalHeight : media instanceof HTMLVideoElement ? media.videoHeight : 0;
      const resourceReady = media instanceof HTMLImageElement ? media.complete && intrinsicWidth > 0 : media instanceof HTMLVideoElement ? media.readyState >= HTMLMediaElement.HAVE_METADATA && intrinsicWidth > 0 : loadedCreativeNodesRef.current.has(media) && bounds.width > 0 && bounds.height > 0;
      const width = intrinsicWidth || Math.round(bounds.width);
      const height = intrinsicHeight || Math.round(bounds.height);
      if (!resourceReady || width <= 0 || height <= 0) return;
      const maxWidth = Math.max(1, window.innerWidth - 32);
      const maxHeight = Math.max(1, Math.min(window.innerHeight * 0.76, window.innerHeight - 140));
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      const fittedSize = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
      settledRef.current = true;
      setCreativeSize(fittedSize);
      setFilled(true);
      onFilled(slotId);
      if (process.env.NODE_ENV === "development") console.info("[reel-display-ad] creative ready", { elapsedMs: Math.round(performance.now() - startedAt), width: fittedSize.width, height: fittedSize.height, aspectRatio: Number((width / height).toFixed(3)) });
      observer?.disconnect();
    };

    observer = new MutationObserver(detectCreative);
    observer.observe(ins, { childList: true, subtree: true, attributes: true });
    try {
      window.AdProvider = window.AdProvider || [];
      window.AdProvider.push({ "serve": {} });
      detectCreative();
    } catch {
      settledRef.current = true;
      onNoFill(slotId);
    }

    return () => observer?.disconnect();
  }, [onFilled, onNoFill, providerFailed, providerReady, request, slotId]);

  return <div className={`exo-display-frame${filled ? " filled" : ""}`} style={creativeSize ? { width: `${creativeSize.width}px`, height: `${creativeSize.height}px` } : undefined}>
    {!filled && <div className="exo-display-skeleton" aria-hidden="true"/>}
    <ins ref={insRef} className="eas6a97888e10" data-zoneid="6047522"/>
  </div>;
}
