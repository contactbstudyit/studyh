"use client";

import { useEffect, useRef, useState } from "react";
import { Command, Film } from "lucide-react";
import type { VideoRecord } from "@/hooks/use-library";
import { getPlaybackFailureReason, probeVideoSource, supportsNativeHls } from "@/lib/video-playback";
import type { SourceProbe, VideoSourceType } from "@/lib/video-playback";

type WatchVideo = Omit<VideoRecord, "video_url">;

export function VideoPlayer({ video, playbackUrl, playbackType, sourceHost }: {
  video: WatchVideo;
  playbackUrl: string;
  playbackType: VideoSourceType;
  sourceHost: string;
}) {
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [sourceType, setSourceType] = useState<VideoSourceType>(playbackType);
  const [diagnostics, setDiagnostics] = useState<SourceProbe & { hlsType: string | null; hlsDetails: string | null; hlsStatus: number | null; mediaErrorCode: number | null }>({
    status: null, contentType: null, finalHost: null, error: null,
    hlsType: null, hlsDetails: null, hlsStatus: null, mediaErrorCode: null,
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);
  const playbackReportedRef = useRef(false);
  const hlsManagedRef = useRef(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    let active = true;
    let dash: { initialize: (media: HTMLVideoElement, source: string, autoplay: boolean) => void; on: (event: string, callback: (event?: unknown) => void) => void; reset: () => void } | undefined;
    let probe: SourceProbe | null = null;
    let resolvedType = playbackType;
    const lifecycle = { attachMediaCalled: false, mediaAttached: false, manifestLoading: false, manifestLoaded: false, manifestParsed: false, fragLoading: false, fragLoaded: false };
    playbackReportedRef.current = false;
    hlsManagedRef.current = false;
    setFailure(""); setLoading(true); setSourceType(playbackType);
    setDiagnostics({ status: null, contentType: null, finalHost: null, error: null, hlsType: null, hlsDetails: null, hlsStatus: null, mediaErrorCode: null });
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (process.env.NODE_ENV === "development") console.info("[video-playback] secure relay selected", { sourceHost, playbackType, pageOrigin: window.location.origin, attempt });

    const probePromise = playbackType === "unknown" ? probeVideoSource(playbackUrl) : null;
    if (probePromise) void probePromise.then((result) => { probe = result; if (active) setDiagnostics((current) => ({ ...current, ...result })); });
    const fail = (detail?: { type?: string; details?: string; status?: number | null }) => {
      if (!active) return;
      const hlsType = detail?.type ?? null;
      const hlsDetails = detail?.details ?? null;
      const hlsStatus = detail?.status ?? null;
      const reason = getPlaybackFailureReason({ sourceType: resolvedType, httpStatus: hlsStatus ?? probe?.status ?? null, probeError: probe?.error ?? null, hlsType, hlsDetails, hlsStatus });
      setDiagnostics((current) => ({ ...current, hlsType, hlsDetails, hlsStatus }));
      setFailure(reason); setLoading(false);
      if (process.env.NODE_ENV === "development") console.error("[video-playback] secure relay failed", { sourceHost, playbackType: resolvedType, pageOrigin: window.location.origin, ...detail, reason, lifecycle: { ...lifecycle } });
    };

    element.pause(); element.removeAttribute("src"); element.load();
    void (async () => {
      try {
        if (resolvedType === "unknown" && probePromise) resolvedType = await probePromise.then((result) => {
          probe = result;
          return result;
        }).then((result) => {
          const detected = result.contentType?.toLowerCase() ?? "";
          if (detected.includes("mpegurl") || detected.includes("m3u")) return "hls";
          if (detected.includes("dash+xml")) return "dash";
          if (detected.includes("video/webm")) return "webm";
          if (detected.includes("video/mp4") || detected.includes("application/mp4")) return "mp4";
          return "unknown";
        });
        if (!active) return;

        if (resolvedType === "hls") {
          if (supportsNativeHls(element)) {
            element.src = playbackUrl; element.load();
          } else {
            const HlsPlayer = (await import("hls.js")).default;
            if (!active) return;
            const supported = HlsPlayer.isSupported();
            if (process.env.NODE_ENV === "development") console.info("[HLS capability]", { sourceHost, pageOrigin: window.location.origin, hlsSupported: supported, canPlayType: element.canPlayType("application/vnd.apple.mpegurl") });
            if (!supported) { fail({ type: "unsupported", details: "hls.js reports MediaSource is unsupported in this browser", status: null }); return; }
            if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
            const hls = new HlsPlayer({ enableWorker: true, lowLatencyMode: false });
            hlsRef.current = hls; hlsManagedRef.current = true;
            hls.on(HlsPlayer.Events.MEDIA_ATTACHED, (_event, data) => { lifecycle.mediaAttached = true; if (process.env.NODE_ENV === "development") console.info("[HLS MEDIA_ATTACHED]", { sourceHost, data }); });
            hls.on(HlsPlayer.Events.MANIFEST_LOADING, () => { lifecycle.manifestLoading = true; if (process.env.NODE_ENV === "development") console.info("[HLS MANIFEST_LOADING]", { sourceHost, request: "same-origin relay" }); });
            hls.on(HlsPlayer.Events.MANIFEST_LOADED, (_event, data) => { lifecycle.manifestLoaded = true; if (process.env.NODE_ENV === "development") console.info("[HLS MANIFEST_LOADED]", { sourceHost, levels: data.levels?.length ?? 0 }); });
            hls.on(HlsPlayer.Events.MANIFEST_PARSED, (_event, data) => { lifecycle.manifestParsed = true; if (!active) return; setLoading(false); if (process.env.NODE_ENV === "development") console.info("[HLS MANIFEST_PARSED]", { sourceHost, levels: data.levels?.length ?? 0 }); void element.play().catch(() => {}); });
            hls.on(HlsPlayer.Events.FRAG_LOADING, (_event, data) => { lifecycle.fragLoading = true; if (process.env.NODE_ENV === "development") console.info("[HLS FRAG_LOADING]", { sourceHost, level: data.frag.level, sequence: data.frag.sn }); });
            hls.on(HlsPlayer.Events.FRAG_LOADED, (_event, data) => { lifecycle.fragLoaded = true; if (process.env.NODE_ENV === "development") console.info("[HLS FRAG_LOADED]", { sourceHost, level: data.frag.level, sequence: data.frag.sn }); });
            hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
              const detail = { type: String(data.type), details: String(data.details), status: data.response?.code ?? null };
              if (process.env.NODE_ENV === "development") console[data.fatal ? "error" : "warn"]("[HLS ERROR]", { sourceHost, pageOrigin: window.location.origin, ...detail, fatal: data.fatal, relayUrl: "[opaque same-origin playback token]", response: data.response, reason: data.reason, error: data.error, lifecycle: { ...lifecycle } });
              if (data.fatal) fail(detail);
            });
            hls.loadSource(playbackUrl); hls.attachMedia(element); lifecycle.attachMediaCalled = true;
          }
        } else if (resolvedType === "dash") {
          const dashModule = await import("dashjs"); if (!active) return;
          const factory = dashModule.MediaPlayer() as unknown as { create: () => typeof dash };
          dash = factory.create();
          if (!dash) { fail({ type: "DASH", details: "DASH player could not be initialized", status: null }); return; }
          dash.initialize(element, playbackUrl, true);
          dash.on(dashModule.MediaPlayer.events.ERROR, (event) => { const info = event && typeof event === "object" ? event as { error?: { message?: string }; code?: number; message?: string } : {}; fail({ type: "DASH", details: info.error?.message ?? info.message ?? "DASH playback error", status: info.code ?? null }); });
        } else { element.src = playbackUrl; element.load(); }
      } catch (error) {
        const details = error instanceof Error ? error.message : "Player initialization failed";
        fail({ type: "player initialization", details, status: null });
      }
    })();
    return () => { active = false; hlsManagedRef.current = false; hlsRef.current?.destroy(); hlsRef.current = null; dash?.reset(); element.pause(); element.removeAttribute("src"); element.load(); };
  }, [playbackUrl, playbackType, sourceHost, attempt]);

  function handleMediaError(event: React.SyntheticEvent<HTMLVideoElement>) {
    if (failure) return;
    const mediaErrorCode = event.currentTarget.error?.code ?? null;
    if (sourceType === "hls" && hlsManagedRef.current) { if (process.env.NODE_ENV === "development") console.warn("[video-playback] media element error while hls.js is active; waiting for fatal HLS event", { sourceHost, mediaErrorCode }); return; }
    const reason = getPlaybackFailureReason({ sourceType, httpStatus: diagnostics.status, probeError: diagnostics.error, mediaErrorCode, hlsType: diagnostics.hlsType, hlsDetails: diagnostics.hlsDetails, hlsStatus: diagnostics.hlsStatus });
    setDiagnostics((current) => ({ ...current, mediaErrorCode })); setLoading(false); setFailure(reason);
    if (process.env.NODE_ENV === "development") console.error("[video-playback] relay media error", { sourceHost, sourceType, mediaErrorCode, mediaErrorMessage: event.currentTarget.error?.message, reason });
  }

  function handlePlaybackStarted() { setLoading(false); if (!playbackReportedRef.current && process.env.NODE_ENV === "development") { playbackReportedRef.current = true; console.info("[video-playback] playback confirmed", { source: sourceHost, format: sourceType.toUpperCase(), relay: "same-origin" }); } }
  const diagnosticLines = [`Source: ${sourceHost}`, `Format: ${sourceType.toUpperCase()}`, diagnostics.hlsStatus !== null ? `HTTP status: ${diagnostics.hlsStatus}` : null, diagnostics.hlsDetails ? `Player detail: ${diagnostics.hlsDetails}` : null];
  return <div className="player-frame" data-source-type={sourceType}><video ref={videoRef} controls autoPlay playsInline preload="metadata" poster={video.thumbnail_url || undefined} onLoadedMetadata={() => setLoading(false)} onCanPlay={() => setLoading(false)} onPlaying={handlePlaybackStarted} onWaiting={() => setLoading(true)} onError={handleMediaError}/>{loading && !failure && <div className="player-loading"><span className="spinner"/><span>Loading video...</span></div>}{failure && <div className="player-error"><Film size={24}/><strong>Unable to play this video</strong><span className="player-reason">{failure}</span><span className="player-diagnostics">{diagnosticLines.join(" · ")}</span><button type="button" onClick={() => { setFailure(""); setAttempt((current) => current + 1); }}>Try again</button></div>}<span className="player-hint"><Command size={12}/> SPACE TO PLAY</span></div>;
}
