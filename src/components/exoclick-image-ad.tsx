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
  const frameRef = useRef<HTMLDivElement>(null);
  const insRef = useRef<HTMLModElement>(null);
  const submittedRef = useRef(false);
  const settledRef = useRef(false);
  const observedCreativeNodesRef = useRef(new WeakSet<Element>());
  const loadedCreativeNodesRef = useRef(new WeakSet<Element>());
  const creativeListenersRef = useRef(new Map<Element, () => void>());
  const filledRef = useRef(false);
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
    const frame = frameRef.current;
    if (!request || providerFailed || !providerReady || !ins || !frame || submittedRef.current) return;
    submittedRef.current = true;
    const startedAt = performance.now();

    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const findProviderCreative = () => {
      const roots = [...frame.children].filter((node) => node !== ins && !node.classList.contains("exo-display-skeleton"));
      for (const root of roots) {
        if (root.matches("iframe, img, video, object, embed")) return root as HTMLElement;
        const nested = root.querySelector<HTMLElement>("iframe, img, video, object, embed");
        if (nested) return nested;
      }
      return null;
    };
    const failCreative = () => {
      if (!request) return;
      if (settledRef.current && !filledRef.current) return;
      settledRef.current = true;
      filledRef.current = false;
      setFilled(false);
      setCreativeSize(null);
      onNoFill(slotId);
    };
    const detectCreative = () => {
      if (settledRef.current) return;
      const media = findProviderCreative();
      if (!media) return;
      if (!observedCreativeNodesRef.current.has(media)) {
        observedCreativeNodesRef.current.add(media);
        const markLoaded = () => { loadedCreativeNodesRef.current.add(media); detectCreative(); };
        const markFailed = () => failCreative();
        for (const eventName of media instanceof HTMLVideoElement ? ["loadedmetadata", "loadeddata", "canplay"] : ["load", "loadeddata"]) {
          media.addEventListener(eventName, markLoaded);
        }
        media.addEventListener("error", markFailed);
        creativeListenersRef.current.set(media, () => {
          for (const eventName of media instanceof HTMLVideoElement ? ["loadedmetadata", "loadeddata", "canplay"] : ["load", "loadeddata"]) media.removeEventListener(eventName, markLoaded);
          media.removeEventListener("error", markFailed);
        });
        resizeObserver?.observe(media);
      }
      const bounds = media.getBoundingClientRect();
      const intrinsicWidth = media instanceof HTMLImageElement ? media.naturalWidth : media instanceof HTMLVideoElement ? media.videoWidth : 0;
      const intrinsicHeight = media instanceof HTMLImageElement ? media.naturalHeight : media instanceof HTMLVideoElement ? media.videoHeight : 0;
      const resourceReady = media instanceof HTMLImageElement ? media.complete && intrinsicWidth > 0 : media instanceof HTMLVideoElement ? media.readyState >= HTMLMediaElement.HAVE_METADATA && intrinsicWidth > 0 : loadedCreativeNodesRef.current.has(media) && bounds.width > 0 && bounds.height > 0;
      const dimension = (styleValue: string, attributeValue: string | null, renderedValue: number) => {
        const styleMatch = styleValue.match(/^(\d+(?:\.\d+)?)px$/);
        const attributeMatch = attributeValue?.match(/^(\d+(?:\.\d+)?)$/);
        return Number(styleMatch?.[1] ?? attributeMatch?.[1] ?? Math.round(renderedValue));
      };
      const width = intrinsicWidth || dimension((media as HTMLElement).style.maxWidth, media.getAttribute("width"), bounds.width);
      const height = intrinsicHeight || dimension((media as HTMLElement).style.maxHeight, media.getAttribute("height"), bounds.height);
      if (!resourceReady || width <= 0 || height <= 0) return;
      const maxWidth = Math.max(1, window.innerWidth - 32);
      const maxHeight = Math.max(1, Math.min(window.innerHeight * 0.76, window.innerHeight - 140));
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      const fittedSize = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
      (media as HTMLElement).style.width = `${fittedSize.width}px`;
      (media as HTMLElement).style.height = `${fittedSize.height}px`;
      settledRef.current = true;
      filledRef.current = true;
      setCreativeSize(fittedSize);
      setFilled(true);
      onFilled(slotId);
      if (process.env.NODE_ENV === "development") console.info("[reel-display-ad] creative ready", { elapsedMs: Math.round(performance.now() - startedAt), width: fittedSize.width, height: fittedSize.height, aspectRatio: Number((width / height).toFixed(3)) });
      observer?.disconnect();
    };

    observer = new MutationObserver(detectCreative);
    resizeObserver = new ResizeObserver(detectCreative);
    observer.observe(frame, { childList: true, subtree: true, attributes: true });
    try {
      window.AdProvider = window.AdProvider || [];
      window.AdProvider.push({ "serve": {} });
      detectCreative();
    } catch {
      settledRef.current = true;
      onNoFill(slotId);
    }

    return () => {
      observer?.disconnect();
      resizeObserver?.disconnect();
      for (const cleanup of creativeListenersRef.current.values()) cleanup();
      creativeListenersRef.current.clear();
    };
  }, [onFilled, onNoFill, providerFailed, providerReady, request, slotId]);

  return <div ref={frameRef} className={`exo-display-frame${filled ? " filled" : ""}`} style={creativeSize ? { width: `${creativeSize.width}px`, height: `${creativeSize.height}px` } : undefined}>
    {!filled && <div className="exo-display-skeleton" aria-hidden="true"/>}
    <ins ref={insRef} className="eas6a97888e10" data-zoneid="6047522"/>
  </div>;
}
