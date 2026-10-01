export type VideoSourceType = "mp4" | "webm" | "hls" | "dash" | "unknown";

export type SourceProbe = {
  status: number | null;
  contentType: string | null;
  finalHost: string | null;
  error: string | null;
};

export function detectSourceType(url: string, contentType?: string | null): VideoSourceType {
  let pathname = "";
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { pathname = url.split(/[?#]/, 1)[0].toLowerCase(); }
  const extension = pathname.match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "mp4" || extension === "m4v") return "mp4";
  if (extension === "webm") return "webm";
  if (extension === "m3u8" || extension === "m3u") return "hls";
  if (extension === "mpd") return "dash";

  const mime = contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (mime === "video/mp4" || mime === "application/mp4") return "mp4";
  if (mime === "video/webm") return "webm";
  if (mime.includes("mpegurl") || mime.includes("m3u")) return "hls";
  if (mime.includes("dash+xml")) return "dash";
  return "unknown";
}

export async function probeVideoSource(url: string, timeoutMs = 5000): Promise<SourceProbe> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, {
      method: "HEAD",
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal,
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        mode: "cors",
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal,
      });
      void response.body?.cancel();
    }
    let finalHost: string | null = null;
    try { finalHost = new URL(response.url).host; } catch { /* Keep unavailable final-host metadata null. */ }
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      finalHost,
      error: null,
    };
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? `Metadata request timed out after ${timeoutMs}ms`
      : error instanceof Error ? error.message : "External metadata request failed";
    return { status: null, contentType: null, finalHost: null, error: message };
  } finally {
    window.clearTimeout(timeout);
  }
}

export function getSourceHost(url: string) {
  try { return new URL(url).host; } catch { return "Invalid URL"; }
}

export function getPlaybackFailureReason(input: {
  sourceType: VideoSourceType;
  httpStatus: number | null;
  probeError: string | null;
  mediaErrorCode?: number | null;
  hlsType?: string | null;
  hlsDetails?: string | null;
  hlsStatus?: number | null;
}): string {
  const status = input.hlsStatus ?? input.httpStatus;
  if (status === 401 || status === 403) return `The external server rejected the browser request (HTTP ${status}). The URL may require authorization or may have expired.`;
  if (status === 404 || status === 410) return `The external video source is unavailable (HTTP ${status}).`;
  if (input.hlsDetails) {
    const category = input.hlsType ? `${input.hlsType}: ` : "HLS playback error: ";
    if ((input.hlsStatus ?? 0) === 0 && input.hlsType?.toLowerCase().includes("network")) return "HLS could not read the playlist or segments. The source may be blocked by CORS or the network.";
    return `${category}${input.hlsDetails}${input.hlsStatus ? ` (HTTP ${input.hlsStatus})` : ""}`;
  }
  if (input.mediaErrorCode === 3) return "The browser received media but could not decode its codec or the media is damaged.";
  if (input.mediaErrorCode === 4) return `The browser does not support this media format${input.sourceType === "unknown" ? " or the source returned an unsupported Content-Type" : ""}.`;
  if (input.probeError?.toLowerCase().includes("cors") || input.mediaErrorCode === 2 && input.probeError) return "The browser could not access the external source. CORS restrictions or a network failure may be blocking playback.";
  if (input.mediaErrorCode === 2) return "The external source could not be loaded. It may be unavailable or require a valid signed URL.";
  if (input.sourceType === "unknown") return "The source format could not be identified and the browser rejected it.";
  return "The browser could not load this external video source.";
}
