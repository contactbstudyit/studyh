"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Command, Film, Maximize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { recordPublicVideoView } from "@/hooks/use-library";
import type { VideoRecord } from "@/hooks/use-library";
import { getPlaybackFailureReason, probeVideoSource, supportsNativeHls } from "@/lib/video-playback";
import type { SourceProbe, VideoSourceType } from "@/lib/video-playback";

type WatchVideo = Omit<VideoRecord, "video_url" | "views" | "display_view_count" | "published_at">;
type PlaybackStatus = "loading" | "ready" | "error";
export type ReelAudioAvailability = "unknown" | "available" | "none";
const MAX_REEL_WARMUP_PLAYBACK_SECONDS = 1.25;

function detectNativeAudioAvailability(element: HTMLVideoElement): ReelAudioAvailability {
  const media = element as HTMLVideoElement & { audioTracks?: { length: number }; mozHasAudio?: boolean; webkitAudioDecodedByteCount?: number };
  if (typeof media.mozHasAudio === "boolean") return media.mozHasAudio ? "available" : "none";
  if (media.audioTracks && element.readyState >= HTMLMediaElement.HAVE_METADATA) return media.audioTracks.length > 0 ? "available" : "none";
  if (typeof media.webkitAudioDecodedByteCount === "number" && media.webkitAudioDecodedByteCount > 0) return "available";
  if (typeof media.webkitAudioDecodedByteCount === "number" && element.currentTime >= 1 && element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return "none";
  return "unknown";
}

export function VideoPlayer({ video, playbackUrl, playbackType, sourceHost, onViewCounted, onPlaybackStarted, onPlaybackStatusChange, onAudioAvailabilityChange, loadingPresentation = "spinner", muted = false, reelAudio = false, controls = true, reelControls = false, preloadOnly = false, warmPreload = true, preloadTargetSeconds = 4, autoPlay, onVideoElement, playerOverlay }: {
  video: WatchVideo;
  playbackUrl: string;
  playbackType: VideoSourceType;
  sourceHost: string;
  onViewCounted?: () => void;
  onPlaybackStarted?: (videoId: string) => void;
  onPlaybackStatusChange?: (videoId: string, status: PlaybackStatus) => void;
  onAudioAvailabilityChange?: (videoId: string, availability: ReelAudioAvailability) => void;
  loadingPresentation?: "spinner" | "external";
  muted?: boolean;
  reelAudio?: boolean;
  controls?: boolean;
  reelControls?: boolean;
  preloadOnly?: boolean;
  warmPreload?: boolean;
  preloadTargetSeconds?: number;
  autoPlay?: boolean;
  onVideoElement?: (element: HTMLVideoElement | null) => void;
  playerOverlay?: ReactNode;
}) {
  const shouldAutoplay = autoPlay ?? (!preloadOnly && !reelAudio);
  const allowAutomaticPlayback = autoPlay !== false;
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
  const preloadWarmCompletedRef = useRef(false);
  const preloadWarmTimeoutRef = useRef<number | null>(null);
  const warmPreloadRef = useRef(warmPreload);
  const previousWarmPreloadRef = useRef(warmPreload);
  const preloadTargetSecondsRef = useRef(preloadTargetSeconds);
  const playbackStatusCallbackRef = useRef(onPlaybackStatusChange);
  const playbackStartedCallbackRef = useRef(onPlaybackStarted);
  const audioAvailabilityCallbackRef = useRef(onAudioAvailabilityChange);
  const audioAvailabilityRef = useRef<ReelAudioAvailability>("unknown");
  const reelAudioRef = useRef(reelAudio);
  const autoplayMutedRef = useRef(false);
  const activePlayAttemptRef = useRef(false);
  const playbackAttemptIdRef = useRef(0);
  const [autoplayMuted, setAutoplayMuted] = useState(false);
  const [mediaTime, setMediaTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [mediaPlaying, setMediaPlaying] = useState(false);
  const [mediaMuted, setMediaMuted] = useState(muted);
  const [mediaVolume, setMediaVolume] = useState(1);
  const [mediaPlaybackRate, setMediaPlaybackRate] = useState(1);
  const [mobileControls, setMobileControls] = useState(false);
  const [tapBurst, setTapBurst] = useState<{ id: number; action: "play" | "pause" | "back" | "forward"; x: number; y: number } | null>(null);
  const tapBurstTimerRef = useRef<number | null>(null);
  const setVideoElement = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    onVideoElement?.(element);
  }, [onVideoElement]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const update = () => setMobileControls(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => () => {
    if (tapBurstTimerRef.current !== null) window.clearTimeout(tapBurstTimerRef.current);
  }, []);
  const showCustomControls = (reelControls || (controls && mobileControls)) && !preloadOnly;
  const showNativeControls = controls && !reelControls && !mobileControls;
  preloadOnlyRef.current = preloadOnly;
  warmPreloadRef.current = warmPreload;
  preloadTargetSecondsRef.current = preloadTargetSeconds;
  playbackStatusCallbackRef.current = onPlaybackStatusChange;
  playbackStartedCallbackRef.current = onPlaybackStarted;
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
    preloadWarmCompletedRef.current = false;
    if (preloadWarmTimeoutRef.current !== null) window.clearTimeout(preloadWarmTimeoutRef.current);
    preloadWarmTimeoutRef.current = null;
    autoplayMutedRef.current = false;
    activePlayAttemptRef.current = false;
    playbackAttemptIdRef.current += 1;
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
    setMediaTime(0);
    setMediaDuration(Number.isFinite(element.duration) ? element.duration : 0);
    setMediaPlaying(false);
    setMediaMuted(element.muted);
    setMediaVolume(element.volume);
    setMediaPlaybackRate(element.playbackRate || 1);
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
            const reelActiveBuffers = reelAudio
              ? { maxBufferLength: 12, maxMaxBufferLength: 15, maxBufferSize: 24 * 1024 * 1024, backBufferLength: 12, startFragPrefetch: false }
              : {
                  maxBufferLength: defaultBufferConfig.maxBufferLength,
                  maxMaxBufferLength: defaultBufferConfig.maxMaxBufferLength,
                  maxBufferSize: defaultBufferConfig.maxBufferSize,
                  backBufferLength: defaultBufferConfig.backBufferLength,
                  startFragPrefetch: defaultBufferConfig.startFragPrefetch,
                };
            hlsBufferDefaultsRef.current = {
              ...reelActiveBuffers,
            };
            const hls = new HlsPlayer({
              enableWorker: true,
              lowLatencyMode: false,
              ...(reelAudio ? (preloadOnly
                ? warmPreload
                  ? { autoStartLoad: true, maxBufferLength: preloadTargetSeconds, maxMaxBufferLength: preloadTargetSeconds + 1, maxBufferSize: 8 * 1024 * 1024, backBufferLength: 0, startFragPrefetch: true }
                  : { autoStartLoad: false, startFragPrefetch: false }
                : { ...reelActiveBuffers, autoStartLoad: true }) : {}),
            });
            hlsRef.current = hls; hlsManagedRef.current = true;
            hls.on(HlsPlayer.Events.MEDIA_ATTACHED, () => { lifecycle.mediaAttached = true; if (process.env.NODE_ENV === "development") console.info("[HLS MEDIA_ATTACHED]", { sourceHost, attached: true }); });
            hls.on(HlsPlayer.Events.MANIFEST_LOADING, () => { lifecycle.manifestLoading = true; if (process.env.NODE_ENV === "development") console.info("[HLS MANIFEST_LOADING]", { sourceHost, request: "same-origin relay" }); });
            hls.on(HlsPlayer.Events.MANIFEST_LOADED, (_event, data) => { lifecycle.manifestLoaded = true; if (process.env.NODE_ENV === "development") console.info("[HLS MANIFEST_LOADED]", { sourceHost, levels: data.levels?.length ?? 0 }); });
            hls.on(HlsPlayer.Events.MANIFEST_PARSED, (_event, data) => { lifecycle.manifestParsed = true; if (!active) return; const ready = hasPlayableMedia(element); setLoading(!ready); playbackStatusCallbackRef.current?.(video.id, ready ? "ready" : "loading"); const hasAudio = data.audio || data.altAudio || data.audioTracks.length > 0 || data.levels.some((level) => Boolean(level.audioCodec)); publishAudioAvailability(hasAudio ? "available" : "none"); if (process.env.NODE_ENV === "development") console.info("[HLS MANIFEST_PARSED]", { sourceHost, levels: data.levels?.length ?? 0 }); if (preloadOnlyRef.current) startSilentWarm(element); else if (allowAutomaticPlayback) startActivePlayback(element); });
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
          dash.initialize(element, playbackUrl, allowAutomaticPlayback && !preloadOnly);
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
    return () => { active = false; if (preloadWarmTimeoutRef.current !== null) window.clearTimeout(preloadWarmTimeoutRef.current); preloadWarmTimeoutRef.current = null; hlsManagedRef.current = false; hlsRef.current?.destroy(); hlsRef.current = null; dash?.reset(); element.pause(); element.removeAttribute("src"); element.load(); };
  }, [playbackUrl, playbackType, sourceHost, attempt, allowAutomaticPlayback, shouldAutoplay]);

  useEffect(() => {
    const wasPreloading = previousPreloadModeRef.current;
    previousPreloadModeRef.current = preloadOnly;
    const wasWarmPreload = previousWarmPreloadRef.current;
    previousWarmPreloadRef.current = warmPreload;
    if (wasPreloading === preloadOnly && wasWarmPreload === warmPreload) return;
    const element = videoRef.current;
    if (!element) return;

    const hls = hlsRef.current;
    const defaults = hlsBufferDefaultsRef.current;
    if (preloadOnly) {
      if (preloadWarmTimeoutRef.current !== null) window.clearTimeout(preloadWarmTimeoutRef.current);
      preloadWarmTimeoutRef.current = null;
      preloadWarmStartedRef.current = false;
      preloadWarmCompletedRef.current = false;
      playbackAttemptIdRef.current += 1;
      activePlayAttemptRef.current = false;
      autoplayMutedRef.current = false;
      setAutoplayMuted(false);
      element.pause();
      element.muted = true;
      element.volume = 0;
      try { element.currentTime = 0; } catch { /* The media may not be seekable until its first range arrives. */ }
      if (hls) {
        hls.config.maxBufferLength = warmPreload ? preloadTargetSeconds : defaults?.maxBufferLength ?? 30;
        hls.config.maxMaxBufferLength = warmPreload ? preloadTargetSeconds + 1 : defaults?.maxMaxBufferLength ?? 30;
        hls.config.maxBufferSize = warmPreload ? 8 * 1024 * 1024 : defaults?.maxBufferSize ?? 24 * 1024 * 1024;
        hls.config.backBufferLength = 0;
        hls.config.startFragPrefetch = warmPreload;
        if (warmPreload) hls.startLoad(-1); else hls.stopLoad();
      }
      setLoading(false);
      preloadWarmStartedRef.current = false;
      if (warmPreload) startSilentWarm(element);
      return;
    }

    if (wasPreloading && reelAudio && element.currentTime > 0.25 && element.buffered.length > 0) {
      try {
        if (element.buffered.start(0) <= 0.05 && element.buffered.end(0) >= element.currentTime) element.currentTime = 0;
      } catch { /* Keep the warmed position if seeking back to a buffered frame is unsupported. */ }
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
  }, [preloadOnly, warmPreload, preloadTargetSeconds]);

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

  function bufferedAheadSeconds(element: HTMLVideoElement) {
    const time = element.currentTime;
    for (let index = 0; index < element.buffered.length; index += 1) {
      const start = element.buffered.start(index);
      const end = element.buffered.end(index);
      if (start <= time + 0.15 && end >= time) return Math.max(0, end - time);
    }
    return 0;
  }

  function stopPreloadWarmup(element: HTMLVideoElement) {
    if (!preloadOnlyRef.current || preloadWarmCompletedRef.current) return;
    preloadWarmCompletedRef.current = true;
    preloadWarmStartedRef.current = false;
    if (preloadWarmTimeoutRef.current !== null) window.clearTimeout(preloadWarmTimeoutRef.current);
    preloadWarmTimeoutRef.current = null;
    element.pause();
    if (hlsManagedRef.current) hlsRef.current?.stopLoad();
  }

  function checkPreloadWarmBuffer(element: HTMLVideoElement) {
    if (!preloadOnlyRef.current || !preloadWarmStartedRef.current || preloadWarmCompletedRef.current) return;
    if (bufferedAheadSeconds(element) >= preloadTargetSecondsRef.current || element.currentTime >= MAX_REEL_WARMUP_PLAYBACK_SECONDS) stopPreloadWarmup(element);
  }

  function startActivePlayback(element: HTMLVideoElement) {
    if (preloadOnlyRef.current) return;
    if (!reelAudioRef.current) {
      void element.play().catch(() => {});
      return;
    }
    if (activePlayAttemptRef.current) return;
    const attemptId = ++playbackAttemptIdRef.current;
    activePlayAttemptRef.current = true;
    element.volume = 1;
    element.muted = autoplayMutedRef.current;
    void element.play().then(() => {
      if (attemptId !== playbackAttemptIdRef.current) return;
      setLoading(false);
      element.volume = 1;
      element.muted = autoplayMutedRef.current;
      activePlayAttemptRef.current = false;
    }).catch((error) => {
      if (attemptId !== playbackAttemptIdRef.current) return;
      if (error && typeof error === "object" && "name" in error && error.name === "NotAllowedError") {
        if (autoplayMutedRef.current) { activePlayAttemptRef.current = false; return; }
        autoplayMutedRef.current = true;
        setAutoplayMuted(true);
        element.volume = 1;
        element.muted = true;
        void element.play().then(() => {
          if (attemptId === playbackAttemptIdRef.current) setLoading(false);
        }).catch(() => {}).finally(() => {
          if (attemptId === playbackAttemptIdRef.current) activePlayAttemptRef.current = false;
        });
        return;
      }
      activePlayAttemptRef.current = false;
    });
  }

  useEffect(() => {
    if (!reelAudio || preloadOnly) return;
    const unlockAudio = () => {
      const element = videoRef.current;
      if (!element || preloadOnlyRef.current || !autoplayMutedRef.current) return;
      playbackAttemptIdRef.current += 1;
      autoplayMutedRef.current = false;
      setAutoplayMuted(false);
      element.volume = 1;
      element.muted = false;
      activePlayAttemptRef.current = false;
      startActivePlayback(element);
    };
    document.addEventListener("pointerdown", unlockAudio, true);
    document.addEventListener("keydown", unlockAudio, true);
    return () => {
      document.removeEventListener("pointerdown", unlockAudio, true);
      document.removeEventListener("keydown", unlockAudio, true);
    };
  }, [preloadOnly, reelAudio]);

  function startSilentWarm(element: HTMLVideoElement) {
    if (!preloadOnlyRef.current || !warmPreloadRef.current || preloadWarmStartedRef.current || preloadWarmCompletedRef.current) return;
    const targetSeconds = preloadTargetSecondsRef.current;
    if (Number.isFinite(element.duration) && element.duration > 0 && element.duration <= targetSeconds + 0.5) {
      preloadWarmCompletedRef.current = true;
      if (hlsManagedRef.current) hlsRef.current?.stopLoad();
      return;
    }
    preloadWarmStartedRef.current = true;
    preloadWarmTimeoutRef.current = window.setTimeout(() => stopPreloadWarmup(element), 7000);
    void element.play().catch(() => {
      preloadWarmCompletedRef.current = true;
      preloadWarmStartedRef.current = false;
      if (preloadWarmTimeoutRef.current !== null) window.clearTimeout(preloadWarmTimeoutRef.current);
      preloadWarmTimeoutRef.current = null;
    });
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
    setMediaPlaying(true);
    const element = videoRef.current;
    if (element) publishNativeAudioAvailability(element);
    if (preloadOnlyRef.current) {
      if (!element) {
        playbackStatusCallbackRef.current?.(video.id, "loading");
        return;
      }
      checkPreloadWarmBuffer(element);
      playbackStatusCallbackRef.current?.(video.id, hasPlayableMedia(element) ? "ready" : "loading");
      return;
    }
    playbackStatusCallbackRef.current?.(video.id, "ready");
    if (!playbackReportedRef.current && process.env.NODE_ENV === "development") { playbackReportedRef.current = true; console.info("[video-playback] playback confirmed", { source: sourceHost, format: sourceType.toUpperCase(), relay: "same-origin" }); }
    if (viewedVideoIdRef.current !== video.id) {
      viewedVideoIdRef.current = video.id;
      void recordPublicVideoView(video.id).then((counted) => { if (counted) onViewCounted?.(); });
    }
    playbackStartedCallbackRef.current?.(video.id);
  }

  function formatMediaTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainder = wholeSeconds % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  async function toggleMediaPlayback() {
    const element = videoRef.current;
    if (!element || preloadOnlyRef.current) return;
    if (element.paused || element.ended) {
      try { await element.play(); } catch { /* Existing player and ad listeners handle blocked or intercepted playback. */ }
    } else element.pause();
  }

  function seekMedia(position: number) {
    const element = videoRef.current;
    if (!element || !Number.isFinite(element.duration)) return;
    const next = Math.min(element.duration, Math.max(0, position));
    element.currentTime = next;
    setMediaTime(next);
  }

  function cycleMediaPlaybackRate() {
    const element = videoRef.current;
    if (!element) return;
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = rates.indexOf(element.playbackRate);
    const nextRate = rates[(currentIndex + 1 + rates.length) % rates.length];
    element.playbackRate = nextRate;
    setMediaPlaybackRate(nextRate);
  }

  function toggleMediaMute() {
    const element = videoRef.current;
    if (!element) return;
    element.muted = !element.muted;
    if (!element.muted && element.volume === 0) element.volume = 1;
    setMediaMuted(element.muted);
    setMediaVolume(element.volume);
  }

  async function requestMediaFullscreen() {
    const element = videoRef.current;
    if (!element) return;
    try {
      if (element.requestFullscreen) await element.requestFullscreen();
      else (element as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
    } catch { /* Fullscreen can be blocked by the browser or preview iframe. */ }
  }

  function triggerTapBurst(action: "play" | "pause" | "back" | "forward", event: ReactMouseEvent<HTMLButtonElement>) {
    const frame = event.currentTarget.closest<HTMLElement>(".player-frame");
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const x = action === "back" ? rect.width * 0.25 : action === "forward" ? rect.width * 0.75 : rect.width / 2;
    setTapBurst({ id: Date.now() + Math.random(), action, x, y: rect.height / 2 });
    if (tapBurstTimerRef.current !== null) window.clearTimeout(tapBurstTimerRef.current);
    tapBurstTimerRef.current = window.setTimeout(() => setTapBurst(null), 620);
  }

  function skipReelBy(seconds: number) {
    const element = videoRef.current;
    if (!element) return;
    seekMedia((Number.isFinite(element.currentTime) ? element.currentTime : mediaTime) + seconds);
  }

  const remainingTime = Math.max(0, mediaDuration - mediaTime);
  const progressPercent = mediaDuration > 0 ? Math.min(100, Math.max(0, (mediaTime / mediaDuration) * 100)) : 0;
  return <div className={`player-frame${preloadOnly ? " preload-only" : ""}`} data-source-type={sourceType} aria-hidden={preloadOnly || undefined}>
    <video ref={setVideoElement} controls={showNativeControls} autoPlay={shouldAutoplay} playsInline muted={preloadOnly || muted || (reelAudio && autoplayMuted)} preload="metadata" poster={video.thumbnail_url || undefined}
      onLoadedMetadata={(event) => { const element = event.currentTarget; if (element.closest(".reel-media, .reels-player-layer") && element.videoWidth && element.videoHeight) element.dataset.reelOrientation = element.videoHeight > element.videoWidth ? "portrait" : "landscape"; setMediaDuration(Number.isFinite(element.duration) ? element.duration : 0); setMediaTime(element.currentTime || 0); publishNativeAudioAvailability(element); const ready = hasPlayableMedia(element); setLoading(!ready); playbackStatusCallbackRef.current?.(video.id, ready ? "ready" : "loading"); if (preloadOnlyRef.current) startSilentWarm(element); }}
      onDurationChange={(event) => setMediaDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onCanPlay={(event) => { publishNativeAudioAvailability(event.currentTarget); setLoading(false); playbackStatusCallbackRef.current?.(video.id, "ready"); if (preloadOnlyRef.current) startSilentWarm(event.currentTarget); checkPreloadWarmBuffer(event.currentTarget); }}
      onPlaying={handlePlaybackStarted}
      onPause={() => setMediaPlaying(false)}
      onWaiting={(event) => { publishNativeAudioAvailability(event.currentTarget); const ready = hasPlayableMedia(event.currentTarget); setLoading(!ready); playbackStatusCallbackRef.current?.(video.id, ready ? "ready" : "loading"); }}
      onTimeUpdate={(event) => { setMediaTime(event.currentTarget.currentTime || 0); setMediaDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); publishNativeAudioAvailability(event.currentTarget); checkPreloadWarmBuffer(event.currentTarget); }}
      onProgress={(event) => checkPreloadWarmBuffer(event.currentTarget)}
      onVolumeChange={(event) => { setMediaMuted(event.currentTarget.muted); setMediaVolume(event.currentTarget.volume); }}
      onError={handleMediaError}/>
    {playerOverlay}
    {reelControls && !preloadOnly && !failure && <div className="reel-tap-overlay">
      <button className="reel-tap-zone reel-tap-zone-back" type="button" aria-label="Back 5 seconds" onClick={(event) => { triggerTapBurst("back", event); skipReelBy(-5); }}></button>
      <button className="reel-tap-zone reel-tap-zone-toggle" type="button" aria-label={mediaPlaying ? "Pause video" : "Play video"} onClick={(event) => { triggerTapBurst(mediaPlaying ? "pause" : "play", event); void toggleMediaPlayback(); }}></button>
      <button className="reel-tap-zone reel-tap-zone-forward" type="button" aria-label="Forward 5 seconds" onClick={(event) => { triggerTapBurst("forward", event); skipReelBy(5); }}></button>
    </div>}
    {tapBurst && <span key={tapBurst.id} className={`reel-tap-burst burst-${tapBurst.action}`} style={{ left: tapBurst.x, top: tapBurst.y }} aria-hidden="true">{tapBurst.action === "play" ? <Play size={22} fill="currentColor"/> : tapBurst.action === "pause" ? <Pause size={22} fill="currentColor"/> : tapBurst.action === "back" ? <RotateCcw size={22}/> : <RotateCw size={22}/>}</span>}
    {showCustomControls && !failure && <div className="video-bottom-controls" onClick={(event) => event.stopPropagation()}>
      <input className="video-timeline" type="range" min={0} max={mediaDuration > 0 ? mediaDuration : 1} step="0.01" value={Math.min(mediaTime, mediaDuration || 0)} style={{ "--video-progress": `${progressPercent}%` } as CSSProperties} aria-label="Video progress" disabled={mediaDuration <= 0} onChange={(event) => seekMedia(Number(event.currentTarget.value))}/>
      <div className="video-control-row">
        <button className="video-control-button video-play-toggle" type="button" aria-label={mediaPlaying ? "Pause video" : "Play video"} onClick={() => void toggleMediaPlayback()}>{mediaPlaying ? <Pause size={25} fill="currentColor"/> : <Play size={25} fill="currentColor"/>}</button>
        <span className="video-time-remaining">-{formatMediaTime(remainingTime)}{mediaDuration > 0 && <span className="video-time-total"> / {formatMediaTime(mediaDuration)}</span>}</span>
         <button className="video-control-button video-speed-button" type="button" aria-label={`Playback speed ${mediaPlaybackRate}x`} onClick={cycleMediaPlaybackRate}>{mediaPlaybackRate}x</button>
         {reelControls
           ? <button className="video-control-button" type="button" aria-label={mediaMuted || mediaVolume === 0 ? "Unmute video" : "Mute video"} onClick={toggleMediaMute}>{mediaMuted || mediaVolume === 0 ? <VolumeX size={23}/> : <Volume2 size={23}/>}</button>
           : <button className="video-control-button video-fullscreen-button" type="button" aria-label="Enter fullscreen" onClick={() => void requestMediaFullscreen()}><Maximize size={23}/></button>}
      </div>
    </div>}
    {loading && !failure && loadingPresentation === "spinner" && <div className="player-loading"><span className="spinner"/><span>Loading video...</span></div>}
    {failure && <div className="player-error"><Film size={24}/><strong>Unable to play this video</strong><button type="button" onClick={() => { setFailure(""); setAttempt((current) => current + 1); }}>Try again</button></div>}
    {!controls && !reelControls && <span className="player-hint"><Command size={12}/> SPACE TO PLAY</span>}
  </div>;
}
