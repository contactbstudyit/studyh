"use client";

import { useEffect, useRef, useState } from "react";
import { Command, Film } from "lucide-react";
import { recordPublicVideoView } from "@/hooks/use-library";
import type { VideoRecord } from "@/hooks/use-library";
import { getPlaybackFailureReason, probeVideoSource, supportsNativeHls } from "@/lib/video-playback";
import type { SourceProbe, VideoSourceType } from "@/lib/video-playback";

type WatchVideo = Omit<VideoRecord, "video_url" | "views" | "display_view_count" | "published_at">;
type PlaybackStatus = "loading" | "ready" | "error";
export type ReelAudioAvailability = "unknown" | "available" | "none";

function detectNativeAudioAvailability(element: HTMLVideoElement): ReelAudioAvailability {
  const media = element as HTMLVideoElement & { audioTracks?: { length: number }; mozHasAudio?: boolean; webkitAudioDecodedByteCount?: number };
  if (typeof media.mozHasAudio === "boolean") return media.mozHasAudio ? "available" : "none";
  if (media.audioTracks && element.readyState >= HTMLMediaElement.HAVE_METADATA) return media.audioTracks.length > 0 ? "available" : "none";
  if (typeof media.webkitAudioDecodedByteCount === "number" && media.webkitAudioDecodedByteCount > 0) return "available";
  return "unknown";
}

export function VideoPlayer({ video, playbackUrl, playbackType, sourceHost, onViewCounted, onPlaybackStatusChange, onAudioAvailabilityChange, loadingPresentation = "spinner", muted = false, reelAudio = false, controls = true, preloadOnly = false }: {
  video: WatchVideo;
  playbackUrl: string;
  playbackType: VideoSourceType;
  sourceHost: string;
  onViewCounted?: () => void;
  onPlaybackStatusChange?: (videoId: string, status: PlaybackStatus) => void;
  onAudioAvailabilityChange?: (videoId: string, availability: ReelAudioAvailability) => void;
  loadingPresentation?: "spinner" | "external";
  muted?: boolean;
  reelAudio?: boolean;
  controls?: boolean;
  preloadOnly?: boolean;
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
  const hlsBufferDefaultsRef = useRef<{ maxBufferLength: number; maxMaxBufferLength: number; maxBufferSize: number; backBufferLength: number; startFragPrefetch: boolean } | null>(null);
  const preloadOnlyRef = useRef(preloadOnly);
  const previousPreloadModeRef = useRef(preloadOnly);
  const preloadWarmStartedRef = useRef(false);
  const playbackStatusCallbackRef = useRef(onPlaybackStatusChange);
  const audioAvailabilityCallbackRef = useRef(onAudioAvailabilityChange);
  const audioAvailabilityRef = useRef<ReelAudioAvailability>("unknown");
  const reelAudioRef = useRef(reelAudio);
  const autoplayMutedRef = useRef(false);
  const [autoplayMuted, setAutoplayMuted] = useState(false);
  preloadOnlyRef.current = preloadOnly;
  playbackStatusCallbackRef.current = onPlaybackStatusChange;
  audioAvailabilityCallbackRef.current = onAudioAvailabilityChange;
  reelAudioRef.current = reelAudio;
  const playbackReportedRef = useRef(false);
  const viewedVideoIdRef = useRef<string | null>(null);
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
    preloadWarmStartedRef.current = false;
    autoplayMutedRef.current = false;
    setAutoplayMuted(false);
    audioAvailabilityRef.current = "unknown";
    audioAvailabilityCallbackRef.current?.(video.id, "unknown");
    hlsManagedRef.current = false;
    setFailure(""); setLoading(true); setSourceType(playbackType);
    playbackStatusCallbackRef.current?.(video.id, "loading");
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
      playbackStatusCallbackRef.current?.(video.id, "error");
      if (process.env.NODE_ENV === "development") console.error("[video-playback] secure relay failed", { sourceHost, playbackType: resolvedType, pageOrigin: window.location.origin, failureType: hlsType, status: hlsStatus, reason, lifecycle: { ...lifecycle } });
    };

    element.pause();
    if (preloadOnly) { element.muted = true; element.volume = 0; }
    else if (reelAudio) { element.muted = false; element.volume = 1; }
    else element.muted = muted;
    element.removeAttribute("src"); element.load();
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
            publishNativeAudioAvailability(element);
            if (reelAudio && !preloadOnly) startActivePlayback(element);
          } else {
            const HlsPlayer = (await import("hls.js")).default;
            if (!active) return;
            const supported = HlsPlayer.isSupported();
            if (process.env.NODE_ENV === "development") console.info("[HLS capability]", { sourceHost, pageOrigin: window.location.origin, hlsSupported: supported, canPlayType: element.canPlayType("application/vnd.apple.mpegurl") });
            if (!supported) { fail({ type: "unsupported", details: "hls.js reports MediaSource is unsupported in this browser", status: null }); return; }
            if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
            const defaultBufferConfig = HlsPlayer.DefaultConfig;
            hlsBufferDefaultsRef.current = {
              maxBufferLength: defaultBufferConfig.maxBufferLength,
              maxMaxBufferLength: defaultBufferConfig.maxMaxBufferLength,
              maxBufferSize: defaultBufferConfig.maxBufferSize,
              backBufferLength: defaultBufferConfig.backBufferLength,
              startFragPrefetch: defaultBufferConfig.startFragPrefetch,
            };
            const hls = new HlsPlayer({
              enableWorker: true,
              lowLatencyMode: false,
              ...(preloadOnly ? { maxBufferLength: 2, maxMaxBufferLength: 3, maxBufferSize: 4 * 1024 * 1024, backBufferLength: 0, startFragPrefetch: true } : {}),
            });
            hlsRef.current = hls; hlsManagedRef.current = true;
            hls.on(HlsPlayer.Events.MEDIA_ATTACHED, () => { lifecycle.mediaAttached = true; if (process.env.NODE_ENV === "development") console.info("[HLS MEDIA_ATTACHED]", { sourceHost, attached: true }); });
            hls.on(HlsPlayer.Events.MANIFEST_LOADING, () => { lifecycle.manifestLoading = true; if (process.env.NODE_ENV === "development") console.info("[HLS MANIFEST_LOADING]", { sourceHost, request: "same-origin relay" }); });
            hls.on(HlsPlayer.Events.MANIFEST_LOADED, (_event, data) => { lifecycle.manifestLoaded = true; if (process.env.NODE_ENV === "development") console.info("[HLS MANIFEST_LOADED]", { sourceHost, levels: data.levels?.length ?? 0 }); });
            hls.on(HlsPlayer.Events.MANIFEST_PARSED, (_event, data) => { lifecycle.manifestParsed = true; if (!active) return; const ready = hasPlayableMedia(element); setLoading(!ready); playbackStatusCallbackRef.current?.(video.id, ready ? "ready" : "loading"); const hasAudio = data.audio || data.altAudio || data.audioTracks.length > 0 || data.levels.some((level) => Boolean(level.audioCodec)); publishAudioAvailability(hasAudio ? "available" : "none"); if (process.env.NODE_ENV === "development") console.info("[HLS MANIFEST_PARSED]", { sourceHost, levels: data.levels?.length ?? 0 }); if (preloadOnlyRef.current) startSilentWarm(element); else startActivePlayback(element); });
            hls.on(HlsPlayer.Events.FRAG_LOADING, (_event, data) => { lifecycle.fragLoading = true; if (process.env.NODE_ENV === "development") console.info("[HLS FRAG_LOADING]", { sourceHost, level: data.frag.level, sequence: data.frag.sn }); });
            hls.on(HlsPlayer.Events.FRAG_LOADED, (_event, data) => { lifecycle.fragLoaded = true; if (process.env.NODE_ENV === "development") console.info("[HLS FRAG_LOADED]", { sourceHost, level: data.frag.level, sequence: data.frag.sn }); });
            hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
              const detail = { type: String(data.type), details: String(data.details), status: data.response?.code ?? null };
              if (process.env.NODE_ENV === "development") console[data.fatal ? "error" : "warn"]("[HLS ERROR]", { sourceHost, pageOrigin: window.location.origin, type: detail.type, status: detail.status, fatal: data.fatal, lifecycle: { ...lifecycle } });
              if (data.fatal) fail(detail);
            });
            hls.loadSource(playbackUrl); hls.attachMedia(element); lifecycle.attachMediaCalled = true;
          }
        } else if (resolvedType === "dash") {
          const dashModule = await import("dashjs"); if (!active) return;
          const factory = dashModule.MediaPlayer() as unknown as { create: () => typeof dash };
          dash = factory.create();
          if (!dash) { fail({ type: "DASH", details: "DASH player could not be initialized", status: null }); return; }
          dash.initialize(element, playbackUrl, !preloadOnly);
          dash.on(dashModule.MediaPlayer.events.ERROR, (event) => { const info = event && typeof event === "object" ? event as { error?: { message?: string }; code?: number; message?: string } : {}; fail({ type: "DASH", details: info.error?.message ?? info.message ?? "DASH playback error", status: info.code ?? null }); });
        } else {
          element.src = playbackUrl;
          element.load();
          if (reelAudio && !preloadOnly) startActivePlayback(element);
        }
      } catch (error) {
        const details = error instanceof Error ? error.message : "Player initialization failed";
        fail({ type: "player initialization", details, status: null });
      }
    })();
    return () => { active = false; hlsManagedRef.current = false; hlsRef.current?.destroy(); hlsRef.current = null; dash?.reset(); element.pause(); element.removeAttribute("src"); element.load(); };
  }, [playbackUrl, playbackType, sourceHost, attempt]);

  useEffect(() => {
    const wasPreloading = previousPreloadModeRef.current;
    previousPreloadModeRef.current = preloadOnly;
    if (wasPreloading === preloadOnly) return;
    const element = videoRef.current;
    if (!element) return;

    const hls = hlsRef.current;
    const defaults = hlsBufferDefaultsRef.current;
    if (preloadOnly) {
      autoplayMutedRef.current = false;
      setAutoplayMuted(false);
      element.pause();
      element.muted = true;
      element.volume = 0;
      try { element.currentTime = 0; } catch { /* The media may not be seekable until its first range arrives. */ }
      if (hls) {
        hls.config.maxBufferLength = 2;
        hls.config.maxMaxBufferLength = 3;
        hls.config.maxBufferSize = 4 * 1024 * 1024;
        hls.config.backBufferLength = 0;
        hls.config.startFragPrefetch = true;
        hls.stopLoad();
        hls.startLoad(-1);
      }
      setLoading(false);
      preloadWarmStartedRef.current = false;
      startSilentWarm(element);
      return;
    }

    if (hls && defaults) {
      hls.config.maxBufferLength = defaults.maxBufferLength;
      hls.config.maxMaxBufferLength = defaults.maxMaxBufferLength;
      hls.config.maxBufferSize = defaults.maxBufferSize;
      hls.config.backBufferLength = defaults.backBufferLength;
      hls.config.startFragPrefetch = defaults.startFragPrefetch;
      hls.startLoad(-1);
    }
    autoplayMutedRef.current = false;
    setAutoplayMuted(false);
    if (reelAudioRef.current) {
      element.muted = false;
      element.volume = 1;
    } else {
      element.muted = muted;
    }
    const buffered = element.buffered.length > 0 && element.buffered.end(element.buffered.length - 1) - element.currentTime > 0.15;
    const ready = element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || buffered;
    setLoading(!ready);
    playbackStatusCallbackRef.current?.(video.id, ready ? "ready" : "loading");
    startActivePlayback(element);
  }, [preloadOnly]);

  function hasPlayableMedia(element: HTMLVideoElement) {
    const buffered = element.buffered.length > 0 && element.buffered.end(element.buffered.length - 1) - element.currentTime > 0.15;
    return element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || buffered;
  }

  function publishAudioAvailability(status: ReelAudioAvailability) {
    if (audioAvailabilityRef.current === status) return;
    audioAvailabilityRef.current = status;
    audioAvailabilityCallbackRef.current?.(video.id, status);
  }

  function publishNativeAudioAvailability(element: HTMLVideoElement) {
    if (hlsManagedRef.current) return;
    const status = detectNativeAudioAvailability(element);
    if (status !== "unknown") publishAudioAvailability(status);
  }

  function retryAfterAutoplayPolicyRejection(element: HTMLVideoElement, error: unknown) {
    if (!reelAudioRef.current || preloadOnlyRef.current || !error || typeof error !== "object" || !("name" in error) || error.name !== "NotAllowedError") return;
    if (!autoplayMutedRef.current) {
      autoplayMutedRef.current = true;
      setAutoplayMuted(true);
    }
    element.volume = 1;
    element.muted = true;
    void element.play().then(() => setLoading(false)).catch(() => {});
  }

  function startActivePlayback(element: HTMLVideoElement) {
    if (preloadOnlyRef.current) return;
    if (!reelAudioRef.current) {
      void element.play().catch(() => {});
      return;
    }
    element.volume = 1;
    element.muted = autoplayMutedRef.current;
    void element.play().then(() => {
      setLoading(false);
      element.volume = 1;
      element.muted = autoplayMutedRef.current;
    }).catch((error) => retryAfterAutoplayPolicyRejection(element, error));
  }

  useEffect(() => {
    if (!reelAudio || preloadOnly) return;
    const unlockAudio = () => {
      const element = videoRef.current;
      if (!element || preloadOnlyRef.current || !autoplayMutedRef.current) return;
      autoplayMutedRef.current = false;
      setAutoplayMuted(false);
      element.volume = 1;
      element.muted = false;
      void element.play().catch((error) => retryAfterAutoplayPolicyRejection(element, error));
    };
    document.addEventListener("pointerdown", unlockAudio, true);
    document.addEventListener("keydown", unlockAudio, true);
    return () => {
      document.removeEventListener("pointerdown", unlockAudio, true);
      document.removeEventListener("keydown", unlockAudio, true);
    };
  }, [preloadOnly, reelAudio]);

  function startSilentWarm(element: HTMLVideoElement) {
    if (!preloadOnlyRef.current || preloadWarmStartedRef.current) return;
    preloadWarmStartedRef.current = true;
    void element.play().catch(() => { preloadWarmStartedRef.current = false; });
  }

  function handleMediaError(event: React.SyntheticEvent<HTMLVideoElement>) {
    if (failure) return;
    const mediaErrorCode = event.currentTarget.error?.code ?? null;
    if (sourceType === "hls" && hlsManagedRef.current) { if (process.env.NODE_ENV === "development") console.warn("[video-playback] media element error while hls.js is active; waiting for fatal HLS event", { sourceHost, mediaErrorCode }); return; }
    const reason = getPlaybackFailureReason({ sourceType, httpStatus: diagnostics.status, probeError: diagnostics.error, mediaErrorCode, hlsType: diagnostics.hlsType, hlsDetails: diagnostics.hlsDetails, hlsStatus: diagnostics.hlsStatus });
    setDiagnostics((current) => ({ ...current, mediaErrorCode })); setLoading(false); setFailure(reason); playbackStatusCallbackRef.current?.(video.id, "error");
    if (process.env.NODE_ENV === "development") console.error("[video-playback] relay media error", { sourceHost, sourceType, mediaErrorCode, reason });
  }

  function handlePlaybackStarted() {
    setLoading(false);
    const element = videoRef.current;
    if (element) publishNativeAudioAvailability(element);
    if (preloadOnlyRef.current) {
      if (!element) {
        playbackStatusCallbackRef.current?.(video.id, "loading");
        return;
      }
      element.pause();
      if (element.currentTime !== 0) {
        try { element.currentTime = 0; } catch { /* Keep the current buffered position if the browser cannot seek yet. */ }
      }
      playbackStatusCallbackRef.current?.(video.id, hasPlayableMedia(element) ? "ready" : "loading");
      return;
    }
    playbackStatusCallbackRef.current?.(video.id, "ready");
    if (!playbackReportedRef.current && process.env.NODE_ENV === "development") { playbackReportedRef.current = true; console.info("[video-playback] playback confirmed", { source: sourceHost, format: sourceType.toUpperCase(), relay: "same-origin" }); }
    if (viewedVideoIdRef.current !== video.id) {
      viewedVideoIdRef.current = video.id;
      void recordPublicVideoView(video.id).then((counted) => { if (counted) onViewCounted?.(); });
    }
  }
  const diagnosticLines = [`Source: ${sourceHost}`, `Format: ${sourceType.toUpperCase()}`, diagnostics.hlsStatus !== null ? `HTTP status: ${diagnostics.hlsStatus}` : null, diagnostics.hlsType ? `Player category: ${diagnostics.hlsType}` : null];
  return <div className={`player-frame${preloadOnly ? " preload-only" : ""}`} data-source-type={sourceType} aria-hidden={preloadOnly || undefined}><video ref={videoRef} controls={controls} autoPlay={!preloadOnly && !reelAudio} playsInline muted={preloadOnly || muted || (reelAudio && autoplayMuted)} preload="metadata" poster={video.thumbnail_url || undefined} onLoadedMetadata={(event) => { const element = event.currentTarget; if (element.closest(".reel-media, .reels-player-layer") && element.videoWidth && element.videoHeight) element.dataset.reelOrientation = element.videoHeight > element.videoWidth ? "portrait" : "landscape"; publishNativeAudioAvailability(element); const ready = hasPlayableMedia(element); setLoading(!ready); playbackStatusCallbackRef.current?.(video.id, ready ? "ready" : "loading"); if (preloadOnlyRef.current) startSilentWarm(element); }} onCanPlay={(event) => { publishNativeAudioAvailability(event.currentTarget); setLoading(false); playbackStatusCallbackRef.current?.(video.id, "ready"); if (preloadOnlyRef.current) startSilentWarm(event.currentTarget); }} onPlaying={handlePlaybackStarted} onWaiting={(event) => { publishNativeAudioAvailability(event.currentTarget); const ready = hasPlayableMedia(event.currentTarget); setLoading(!ready); playbackStatusCallbackRef.current?.(video.id, ready ? "ready" : "loading"); }} onError={handleMediaError}/>{loading && !failure && loadingPresentation === "spinner" && <div className="player-loading"><span className="spinner"/><span>Loading video...</span></div>}{failure && <div className="player-error"><Film size={24}/><strong>Unable to play this video</strong><span className="player-reason">{failure}</span><span className="player-diagnostics">{diagnosticLines.join(" · ")}</span><button type="button" onClick={() => { setFailure(""); setAttempt((current) => current + 1); }}>Try again</button></div>}<span className="player-hint"><Command size={12}/> SPACE TO PLAY</span></div>;
}
