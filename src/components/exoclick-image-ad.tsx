"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    AdProvider?: Array<{ serve: Record<string, never> }>;
  }
}

const MIN_CREATIVE_EDGE = 24;
const CREATIVE_EDGE_PADDING = 6;
const CREATIVE_TIMEOUT_MS = 12000;

function playCreativeVideo(video: HTMLVideoElement) {
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  const attempt = video.play();
  if (!attempt) return;
  void attempt.catch(() => {
    if (video.muted) return;
    video.muted = true;
    void video.play().catch(() => { /* Provider video may require an explicit user gesture. */ });
  });
}

export function ExoclickImageAd({ slotId, request, active = false, providerReady, providerFailed, onFilled, onNoFill }: {
  slotId: string;
  request: boolean;
  active?: boolean;
  providerReady: boolean;
  providerFailed: boolean;
  onFilled: (slotId: string) => void;
  onNoFill: (slotId: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const insRef = useRef<HTMLModElement>(null);
  const submittedRef = useRef(false);
  const settledRef = useRef(false);
  const filledRef = useRef(false);
  const observedCreativeNodesRef = useRef(new WeakSet<Element>());
  const creativeListenersRef = useRef(new Map<Element, () => void>());
  const detectRef = useRef<() => void>(() => {});
  const requestRef = useRef(request);
  const providerReadyRef = useRef(providerReady);
  const activeRef = useRef(active);
  const onFilledRef = useRef(onFilled);
  const onNoFillRef = useRef(onNoFill);
  const [filled, setFilled] = useState(false);
  const [creativeSize, setCreativeSize] = useState<{ width: number; height: number } | null>(null);
  requestRef.current = request;
  providerReadyRef.current = providerReady;
  activeRef.current = active;
  onFilledRef.current = onFilled;
  onNoFillRef.current = onNoFill;

  useEffect(() => {
    if (!request || filled) return;
    if (providerFailed) {
      if (!settledRef.current) { settledRef.current = true; onNoFillRef.current(slotId); }
      return;
    }
    const timeout = window.setTimeout(() => {
      if (settledRef.current) return;
      settledRef.current = true;
      onNoFillRef.current(slotId);
    }, CREATIVE_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [filled, providerFailed, request, slotId]);

  useEffect(() => {
    const frame = frameRef.current;
    const ins = insRef.current;
    if (!frame || !ins) return;

    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const findCreativeRoot = (): HTMLElement | null => {
      for (const node of Array.from(frame.children)) {
        const element = node as HTMLElement;
        if (element === ins || element.classList.contains("exo-display-skeleton")) continue;
        return element;
      }
      return null;
    };
    const failCreative = () => {
      if (!requestRef.current || settledRef.current) return;
      settledRef.current = true;
      filledRef.current = false;
      setFilled(false);
      setCreativeSize(null);
      onNoFillRef.current(slotId);
    };
    const observeCreative = (element: Element) => {
      if (observedCreativeNodesRef.current.has(element)) return;
      observedCreativeNodesRef.current.add(element);
      const markChanged = () => detectRef.current();
      const markFailed = () => failCreative();
      const readyEvents = element instanceof HTMLVideoElement ? ["loadedmetadata", "loadeddata", "canplay"] : ["load", "loadeddata"];
      for (const eventName of readyEvents) element.addEventListener(eventName, markChanged);
      element.addEventListener("error", markFailed);
      creativeListenersRef.current.set(element, () => {
        for (const eventName of readyEvents) element.removeEventListener(eventName, markChanged);
        element.removeEventListener("error", markFailed);
      });
      resizeObserver?.observe(element);
    };

    const detectCreative = () => {
      if (!requestRef.current || !providerReadyRef.current || settledRef.current) return;
      const root = findCreativeRoot();
      if (!root) return;
      observeCreative(root);
      const media = root.matches("iframe, img, video, object, embed") ? root : root.querySelector<HTMLElement>("iframe, img, video, object, embed");
      if (media) observeCreative(media);
      const measured = media ?? root;
      const bounds = measured.getBoundingClientRect();
      const intrinsicWidth = measured instanceof HTMLImageElement ? measured.naturalWidth : measured instanceof HTMLVideoElement ? measured.videoWidth : 0;
      const intrinsicHeight = measured instanceof HTMLImageElement ? measured.naturalHeight : measured instanceof HTMLVideoElement ? measured.videoHeight : 0;
      const resourceReady = measured instanceof HTMLImageElement
        ? measured.complete && intrinsicWidth > 0
        : measured instanceof HTMLVideoElement
          ? measured.readyState >= HTMLMediaElement.HAVE_METADATA && intrinsicWidth > 0
          : bounds.width > 0 && bounds.height > 0;
      const dimension = (styleValue: string, attributeValue: string | null, renderedValue: number) => {
        const styleMatch = styleValue.match(/^(\d+(?:\.\d+)?)px$/);
        const attributeMatch = attributeValue?.match(/^(\d+(?:\.\d+)?)$/);
        return Number(styleMatch?.[1] ?? attributeMatch?.[1] ?? Math.round(renderedValue));
      };
      const width = intrinsicWidth || dimension((measured as HTMLElement).style.maxWidth, measured.getAttribute("width"), bounds.width);
      const height = intrinsicHeight || dimension((measured as HTMLElement).style.maxHeight, measured.getAttribute("height"), bounds.height);
      const containerReady = Boolean(media) || root.childElementCount > 0;
      if (!containerReady || !resourceReady || width < MIN_CREATIVE_EDGE || height < MIN_CREATIVE_EDGE) return;

      const container = frame.parentElement;
      const containerBounds = container?.getBoundingClientRect();
      const availableWidth = Math.max(1, (containerBounds?.width ?? window.innerWidth) - CREATIVE_EDGE_PADDING * 2);
      const availableHeight = Math.max(1, (containerBounds?.height ?? window.innerHeight) - CREATIVE_EDGE_PADDING * 2);
      const directMedia = media !== null && media === root;
      const basisWidth = directMedia ? width : Math.round(root.getBoundingClientRect().width) || width;
      const basisHeight = directMedia ? height : Math.round(root.getBoundingClientRect().height) || height;
      const maxScale = directMedia ? 1 : 3;
      const scale = Math.min(availableWidth / basisWidth, availableHeight / basisHeight, maxScale);
      const fittedSize = { width: Math.max(1, Math.round(basisWidth * scale)), height: Math.max(1, Math.round(basisHeight * scale)) };
      if (directMedia) {
        root.style.width = `${fittedSize.width}px`;
        root.style.height = `${fittedSize.height}px`;
        root.style.maxWidth = "100%";
        root.style.maxHeight = "100%";
      } else {
        root.style.maxWidth = "none";
        root.style.maxHeight = "none";
        root.style.transformOrigin = "center center";
        root.style.transform = `scale(${Number(scale.toFixed(4))})`;
      }
      for (const video of root.querySelectorAll("video")) {
        video.setAttribute("playsinline", "");
        video.playsInline = true;
        if (activeRef.current) playCreativeVideo(video);
      }
      settledRef.current = true;
      filledRef.current = true;
      setCreativeSize(fittedSize);
      setFilled(true);
      onFilledRef.current(slotId);
      if (process.env.NODE_ENV === "development") console.info("[reel-display-ad] creative ready", { width: fittedSize.width, height: fittedSize.height, aspectRatio: Number((width / height).toFixed(3)), kind: media ? media.tagName.toLowerCase() : "container", scale: Number(scale.toFixed(3)) });
    };
    detectRef.current = detectCreative;

    observer = new MutationObserver(detectCreative);
    resizeObserver = new ResizeObserver(detectCreative);
    observer.observe(frame, { childList: true, subtree: true, attributes: true });
    resizeObserver.observe(frame);
    detectCreative();

    return () => {
      detectRef.current = () => {};
      observer?.disconnect();
      resizeObserver?.disconnect();
      for (const cleanup of creativeListenersRef.current.values()) cleanup();
      creativeListenersRef.current.clear();
    };
  }, [slotId]);

  useEffect(() => {
    if (!request || !providerReady || providerFailed || submittedRef.current) return;
    submittedRef.current = true;
    try {
      window.AdProvider = window.AdProvider || [];
      window.AdProvider.push({ "serve": {} });
    } catch {
      if (!settledRef.current) { settledRef.current = true; onNoFillRef.current(slotId); }
      return;
    }
    detectRef.current();
  }, [providerFailed, providerReady, request, slotId]);

  useEffect(() => {
    if (!request || !providerReady || providerFailed) return;
    detectRef.current();
  }, [providerFailed, providerReady, request]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const videos = [...frame.querySelectorAll("video")];
    if (active) {
      for (const video of videos) playCreativeVideo(video);
      return;
    }
    for (const video of videos) {
      try { video.pause(); } catch { /* Provider video may already be detached. */ }
    }
  }, [active, filled]);

  return <div ref={frameRef} className={`exo-display-frame${filled ? " filled" : ""}`} style={creativeSize ? { width: `${creativeSize.width}px`, height: `${creativeSize.height}px` } : undefined}>
    {!filled && <div className="exo-display-skeleton" aria-hidden="true"/>}
    <ins ref={insRef} className="eas6a97888e10" data-zoneid="6047522"/>
  </div>;
}
