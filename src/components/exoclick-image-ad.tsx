"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    AdProvider?: Array<{ serve: Record<string, never> }>;
  }
}

export function ExoclickImageAd({ slotId, active, providerReady, onFilled, onNoFill }: {
  slotId: string;
  active: boolean;
  providerReady: boolean;
  onFilled: (slotId: string) => void;
  onNoFill: (slotId: string) => void;
}) {
  const insRef = useRef<HTMLModElement>(null);
  const submittedRef = useRef(false);
  const settledRef = useRef(false);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!active || filled) return;
    const timeout = window.setTimeout(() => {
      if (settledRef.current) return;
      settledRef.current = true;
      onNoFill(slotId);
    }, 15000);
    return () => window.clearTimeout(timeout);
  }, [active, filled, onNoFill, slotId]);

  useEffect(() => {
    const ins = insRef.current;
    if (!active || !providerReady || !ins || submittedRef.current) return;
    submittedRef.current = true;

    let observer: MutationObserver | null = null;
    const detectCreative = () => {
      if (settledRef.current) return;
      const media = ins.querySelector<HTMLElement>("iframe, img, object, embed");
      if (!media) return;
      const bounds = media.getBoundingClientRect();
      const imageReady = media instanceof HTMLImageElement ? media.complete && media.naturalWidth > 0 : true;
      if (!imageReady || bounds.width < 100 || bounds.height < 100) return;
      settledRef.current = true;
      setFilled(true);
      onFilled(slotId);
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
  }, [active, onFilled, onNoFill, providerReady, slotId]);

  return <div className={`exo-display-frame${filled ? " filled" : ""}`}>
    {!filled && <div className="exo-display-skeleton" aria-hidden="true"/>}
    <ins ref={insRef} className="eas6a97888e10" data-zoneid="6047522"/>
  </div>;
}
