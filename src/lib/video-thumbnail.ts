import { createMediaProxyUrl, detectSourceType, probeVideoSource, supportsNativeHls, VideoSourceType } from "@/lib/video-playback";

const MEDIA_TIMEOUT_MS = 30_000;
const MAX_THUMBNAIL_BYTES = 300_000;

export function isGeneratedThumbnailUrl(videoId: string, thumbnailUrl: string | null | undefined) {
  if (!thumbnailUrl) return false;
  try { return decodeURIComponent(new URL(thumbnailUrl).pathname).includes(`/video-thumbnails/${videoId}/`); }
  catch { return false; }
}

function parseDuration(value: string) {
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function waitForMediaEvent(video: HTMLVideoElement, events: string[], timeoutMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Thumbnail generation cancelled")); return; }
    const alreadyReady = events.some((event) => event === "loadedmetadata" && video.readyState >= HTMLMediaElement.HAVE_METADATA || event === "loadeddata" && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA || event === "canplay" && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
    if (alreadyReady) { resolve(); return; }
    const cleanup = () => {
      window.clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, onReady);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(video.error?.message || `Media error ${video.error?.code ?? "unknown"}`)); };
    const onAbort = () => { cleanup(); reject(new Error("Thumbnail generation cancelled")); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for video metadata/frame")); }, timeoutMs);
    for (const event of events) video.addEventListener(event, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForDecodedFrame(video: HTMLVideoElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Thumbnail generation cancelled")); return; }
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for a decoded video frame")); }, 5000);
    const cleanup = () => { window.clearTimeout(timeout); signal.removeEventListener("abort", onAbort); };
    const onAbort = () => { cleanup(); reject(new Error("Thumbnail generation cancelled")); };
    signal.addEventListener("abort", onAbort, { once: true });
    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback(() => { cleanup(); resolve(); });
    } else {
      requestAnimationFrame(() => requestAnimationFrame(() => { cleanup(); resolve(); }));
    }
  });
}

function encodeCanvas(canvas: HTMLCanvasElement, mime: "image/webp" | "image/jpeg", quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Browser could not encode the thumbnail image")), mime, quality);
  });
}

function frameLooksUseful(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let luminance = 0;
  let spread = 0;
  let count = 0;
  let min = 255;
  let max = 0;
  const stride = 4 * 16;
  for (let index = 0; index < data.length; index += stride) {
    const value = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    luminance += value;
    min = Math.min(min, value);
    max = Math.max(max, value);
    count++;
  }
  const average = count ? luminance / count : 0;
  spread = max - min;
  return average >= 9 || spread >= 16;
}

function drawFrame(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !video.videoWidth || !video.videoHeight) throw new Error("No decoded video frame is available");
  const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  if (!frameLooksUseful(canvas, context)) return null;
  return canvas;
}

async function makeSmallImage(canvas: HTMLCanvasElement) {
  for (const quality of [0.82, 0.75, 0.68, 0.6]) {
    const webp = await encodeCanvas(canvas, "image/webp", quality);
    if (webp.type === "image/webp" && webp.size <= MAX_THUMBNAIL_BYTES) return webp;
  }
  for (const quality of [0.82, 0.75, 0.68, 0.6]) {
    const jpeg = await encodeCanvas(canvas, "image/jpeg", quality);
    if (jpeg.size <= MAX_THUMBNAIL_BYTES) return jpeg;
  }
  throw new Error("Thumbnail image exceeded the size limit");
}

function getSeekTargets(video: HTMLVideoElement, durationHint: string) {
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : parseDuration(durationHint);
  if (duration && duration > 0) {
    const maxTime = Math.max(0, duration - 0.15);
    return [0.5, 0.1, 0.25, 0.75, 0].map((ratio) => Math.min(maxTime, Math.max(0, duration * ratio)));
  }
  if (video.seekable.length) {
    const start = video.seekable.start(0);
    const end = video.seekable.end(video.seekable.length - 1);
    if (Number.isFinite(end) && end > start) return [start + (end - start) * 0.1, start];
  }
  return [0];
}

export async function generateVideoThumbnail(videoUrl: string, durationHint = "", signal = new AbortController().signal) {
  const video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = "auto";
  video.controls = false;
  video.setAttribute("aria-hidden", "true");
  Object.assign(video.style, { position: "fixed", left: "-2px", top: "-2px", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", zIndex: "-1" });
  document.body.append(video);
  const proxiedUrl = createMediaProxyUrl(videoUrl);
  let hls: import("hls.js").default | null = null;
  let dash: { initialize: (media: HTMLVideoElement, source: string, autoplay: boolean) => void; reset: () => void } | null = null;
  const type = detectSourceType(videoUrl);
  try {
    let resolvedType: VideoSourceType = type;
    if (resolvedType === "unknown") {
      const metadata = await probeVideoSource(videoUrl);
      resolvedType = detectSourceType(videoUrl, metadata.contentType);
    }
    if (resolvedType === "hls") {
      if (supportsNativeHls(video)) {
        video.src = proxiedUrl;
        video.load();
        await waitForMediaEvent(video, ["loadedmetadata"], MEDIA_TIMEOUT_MS, signal);
      } else {
        const HlsPlayer = (await import("hls.js")).default;
        if (!HlsPlayer.isSupported()) throw new Error("HLS playback is not supported in this browser");
        hls = new HlsPlayer({ enableWorker: true, lowLatencyMode: false });
        const manifestParsed = new Promise<void>((resolve, reject) => {
          hls?.on(HlsPlayer.Events.MANIFEST_PARSED, () => resolve());
          hls?.on(HlsPlayer.Events.ERROR, (_event, data) => { if (data.fatal) reject(new Error(`HLS ${data.type}: ${data.details}${data.response?.code ? ` (HTTP ${data.response.code})` : ""}`)); });
        });
        hls.loadSource(proxiedUrl);
        hls.attachMedia(video);
        await Promise.race([manifestParsed, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Timed out loading HLS manifest")), MEDIA_TIMEOUT_MS))]);
        await waitForMediaEvent(video, ["loadeddata", "canplay"], MEDIA_TIMEOUT_MS, signal);
      }
    } else if (resolvedType === "dash") {
      const dashModule = await import("dashjs");
      const player = dashModule.MediaPlayer().create();
      dash = player;
      player.initialize(video, proxiedUrl, true);
      await waitForMediaEvent(video, ["loadedmetadata", "loadeddata"], MEDIA_TIMEOUT_MS, signal);
    } else {
      video.src = proxiedUrl;
      video.load();
      await waitForMediaEvent(video, ["loadedmetadata", "loadeddata"], MEDIA_TIMEOUT_MS, signal);
    }

    try { await video.play(); } catch { /* Seeking can still decode a frame if autoplay is blocked. */ }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitForMediaEvent(video, ["loadeddata", "canplay"], MEDIA_TIMEOUT_MS, signal);
    const candidates = getSeekTargets(video, durationHint);
    let captureError: unknown = null;
    for (const target of candidates) {
      try {
        if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.2) {
          const seeked = waitForMediaEvent(video, ["seeked"], 10_000, signal);
          video.currentTime = target;
          await seeked;
        }
        await waitForDecodedFrame(video, signal);
        const canvas = drawFrame(video);
        if (!canvas) continue;
        return await makeSmallImage(canvas);
      } catch (error) { captureError = error; }
    }
    throw captureError instanceof Error ? captureError : new Error("No useful video frame could be captured");
  } finally {
    hls?.destroy();
    dash?.reset();
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}
