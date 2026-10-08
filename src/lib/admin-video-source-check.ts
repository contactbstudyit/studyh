import { createMediaResourceToken, createVideoPlaybackUrl } from "@/lib/media-playback-server";
import { detectSourceType } from "@/lib/video-playback";

export type VideoSourceCheckStatus = "working" | "recovered" | "temporary" | "broken" | "internal";
export type VideoSourceCheck = { status: VideoSourceCheckStatus; reason: string };
export type VideoSourceForCheck = { id: string; video_url: string };

const CHECK_TIMEOUT_MS = 9_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MEDIA_PREFIX_BYTES = 64 * 1024;
const RETRY_DELAY_MS = 700;

type ProxyFetch = { response: Response } | { failure: VideoSourceCheck };

class MediaReadError extends Error {}

function appUrl(origin: string, path: string) {
  const url = new URL(path, origin);
  if (url.origin !== origin || url.pathname !== "/api/media-proxy") throw new Error("Invalid internal media proxy URL");
  return url;
}

async function requestProxy(url: URL, range?: string): Promise<ProxyFetch> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: range ? { Range: range, Accept: "*/*" } : { Accept: "*/*" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return { response };
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { failure: { status: "temporary", reason: "Connection timed out or was interrupted" } };
    }
    return { failure: { status: "internal", reason: "Secure media relay could not be reached" } };
  }
}

async function readPrefix(response: Response, maxBytes: number) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const chunk = Buffer.from(value).subarray(0, maxBytes - size);
      chunks.push(chunk);
      size += chunk.length;
    }
  } catch {
    throw new MediaReadError("Media response was interrupted");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function classifyHttpFailure(response: Response): Promise<VideoSourceCheck | null> {
  if (response.ok) return null;
  const status = response.status;
  if (status === 503 && (response.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await readPrefix(response, 4096)).toString("utf8");
    if (body.includes("Secure media relay signing is not configured")) {
      return { status: "internal", reason: "Secure media relay signing is not configured" };
    }
  }
  if (status === 404 || status === 410) {
    if ((response.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await readPrefix(response, 4096)).toString("utf8");
      if (body.includes("Video is not available") || body.includes("Media source is not available in the public library")) {
        return { status: "internal", reason: "Video publication state changed during the check" };
      }
    } else await cancelResponse(response);
    return { status: "broken", reason: `HTTP ${status}` };
  }
  if (status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500) {
    await cancelResponse(response);
    return { status: "temporary", reason: `HTTP ${status}` };
  }
  if (status >= 300 && status < 400) { await cancelResponse(response); return { status: "temporary", reason: "Unexpected redirect response" }; }
  await cancelResponse(response);
  return { status: "internal", reason: "Secure media relay returned an unexpected response" };
}

function hasMp4Signature(bytes: Buffer) {
  const type = bytes.toString("ascii", 4, 8);
  return ["ftyp", "styp", "moov", "moof", "mdat", "free", "wide"].includes(type);
}

function hasWebmSignature(bytes: Buffer) {
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

function validRangeResponse(response: Response) {
  if (response.status !== 206) return true;
  return /^bytes 0-\d+\/(?:\d+|\*)$/i.test(response.headers.get("content-range") ?? "");
}

async function cancelResponse(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

async function checkByteMedia(video: VideoSourceForCheck, sourceType: "mp4" | "webm", origin: string): Promise<VideoSourceCheck> {
  const proxyUrl = new URL(await createVideoPlaybackUrl(video.id), origin);
  const result = await requestProxy(proxyUrl, "bytes=0-65535");
  if ("failure" in result) return result.failure;
  const { response } = result;
  const httpFailure = await classifyHttpFailure(response);
  if (httpFailure) return httpFailure;
  if (!validRangeResponse(response)) { await cancelResponse(response); return { status: "temporary", reason: "Source returned an invalid byte-range response" }; }

  const bytes = await readPrefix(response, MEDIA_PREFIX_BYTES);
  if (!bytes.length) return { status: "broken", reason: "Empty media response" };
  const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  const rangeNote = response.status === 200 ? " (range request ignored)" : "";
  if (sourceType === "webm" && hasWebmSignature(bytes)) return { status: "working", reason: `WebM media is accessible${rangeNote}` };
  if (sourceType === "mp4" && hasMp4Signature(bytes)) return { status: "working", reason: `MP4 media is accessible${rangeNote}` };
  return { status: "broken", reason: `Invalid ${sourceType.toUpperCase()} media response` };
}

function extractTagUris(line: string) {
  return [...line.matchAll(/URI=(['"])(.*?)\1/gi)].map((match) => match[2]);
}

function playlistReferences(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variants: string[] = [];
  const segments: string[] = [];
  let isMaster = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      isMaster = true;
      const variant = lines.slice(index + 1).find((candidate) => !candidate.startsWith("#"));
      if (variant) variants.push(variant);
    }
    if (line.startsWith("#EXTINF")) {
      const segment = lines.slice(index + 1).find((candidate) => !candidate.startsWith("#"));
      if (segment) segments.push(segment);
    } else if (line.startsWith("#EXT-X-PART:")) {
      segments.push(...extractTagUris(line));
    }
  }
  return { isMaster, variants: [...new Set(variants)], segments: [...new Set(segments)] };
}

async function readManifest(response: Response): Promise<string | VideoSourceCheck> {
  const bytes = await readPrefix(response, MAX_MANIFEST_BYTES + 1);
  if (bytes.length > MAX_MANIFEST_BYTES) return { status: "temporary", reason: "Manifest exceeds the safe inspection limit" };
  return bytes.toString("utf8");
}

async function probeProxyResource(url: URL, range?: string): Promise<VideoSourceCheck> {
  const result = await requestProxy(url, range);
  if ("failure" in result) return result.failure;
  const failure = await classifyHttpFailure(result.response);
  if (failure) return failure;
  if (!validRangeResponse(result.response)) { await cancelResponse(result.response); return { status: "temporary", reason: "Media resource returned an invalid byte-range response" }; }
  const bytes = await readPrefix(result.response, 2048);
  return bytes.length ? { status: "working", reason: "Media resource is accessible" } : { status: "temporary", reason: "Media resource returned no bytes" };
}

async function checkHlsPlaylist(url: URL, text: string, origin: string, depth = 0): Promise<VideoSourceCheck> {
  if (!/^\s*#EXTM3U(?:\s|$)/.test(text)) return { status: "broken", reason: "Invalid HLS manifest" };
  const refs = playlistReferences(text);
  if (refs.isMaster) {
    if (!refs.variants.length) return { status: "broken", reason: "Invalid HLS manifest: no variants" };
    if (depth >= 2) return { status: "temporary", reason: "Nested HLS variants exceed the safe check depth" };
    const outcomes: VideoSourceCheck[] = [];
    for (const reference of refs.variants.slice(0, 8)) {
      let variantUrl: URL;
      try { variantUrl = new URL(reference, url); }
      catch { outcomes.push({ status: "broken", reason: "Invalid HLS variant URL" }); continue; }
      let proxyUrl: URL;
      try { proxyUrl = appUrl(origin, `${variantUrl.pathname}${variantUrl.search}`); }
      catch { return { status: "internal", reason: "HLS variant did not use the secure media relay" }; }
      const fetched = await requestProxy(proxyUrl);
      if ("failure" in fetched) { outcomes.push(fetched.failure); continue; }
      const failure = await classifyHttpFailure(fetched.response);
      if (failure) { outcomes.push(failure); continue; }
      const variantText = await readManifest(fetched.response);
      if (typeof variantText !== "string") { outcomes.push(variantText); continue; }
      outcomes.push(await checkHlsPlaylist(variantUrl, variantText, origin, depth + 1));
      if (outcomes[outcomes.length - 1].status === "working") return outcomes[outcomes.length - 1];
    }
    if (outcomes.some((outcome) => outcome.status === "internal")) return outcomes.find((outcome) => outcome.status === "internal")!;
    if (outcomes.some((outcome) => outcome.status === "temporary")) return outcomes.find((outcome) => outcome.status === "temporary")!;
    if (refs.variants.length > 8) return { status: "temporary", reason: "Additional HLS variants were not checked" };
    return { status: "broken", reason: outcomes[0]?.reason ?? "No HLS variants are available" };
  }
  if (!refs.segments.length) {
    return /#EXTINF|#EXT-X-PART/.test(text)
      ? { status: "temporary", reason: "Valid HLS playlist has no media segment to probe yet" }
      : { status: "broken", reason: "Invalid HLS manifest: no media segments" };
  }
  const outcomes: VideoSourceCheck[] = [];
  for (const reference of refs.segments.slice(0, 3)) {
    let segmentUrl: URL;
    try { segmentUrl = new URL(reference, url); }
    catch { outcomes.push({ status: "broken", reason: "Invalid HLS media URL" }); continue; }
    let proxyUrl: URL;
    try { proxyUrl = appUrl(origin, `${segmentUrl.pathname}${segmentUrl.search}`); }
    catch { return { status: "internal", reason: "HLS segment did not use the secure media relay" }; }
    outcomes.push(await probeProxyResource(proxyUrl, "bytes=0-1023"));
    if (outcomes[outcomes.length - 1].status === "working") return { status: "working", reason: "HLS manifest and media segment are accessible" };
  }
  if (outcomes.some((outcome) => outcome.status === "internal")) return outcomes.find((outcome) => outcome.status === "internal")!;
  if (outcomes.some((outcome) => outcome.status === "temporary")) return outcomes.find((outcome) => outcome.status === "temporary")!;
  return { status: "broken", reason: outcomes[0]?.reason ?? "HLS media segments are unavailable" };
}

function xmlText(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

function elementText(xml: string, element: string) {
  const match = xml.match(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)<\\/${element}\\s*>`, "i"));
  return match ? xmlText(match[1]) : null;
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, "i"));
  return match ? xmlText(match[1]) : null;
}

function firstDashSegment(xml: string) {
  const segmentUrl = xml.match(/<(?:[\w.-]+:)?SegmentURL\b[^>]*>/i)?.[0];
  if (segmentUrl) {
    const media = attribute(segmentUrl, "media");
    if (media) return media;
  }
  const template = xml.match(/<(?:[\w.-]+:)?SegmentTemplate\b[^>]*>/i)?.[0];
  const mediaTemplate = template && attribute(template, "media");
  if (mediaTemplate) {
    const representation = xml.match(/<(?:[\w.-]+:)?Representation\b[^>]*>/i)?.[0] ?? "";
    const id = attribute(representation, "id") ?? "";
    const bandwidth = attribute(representation, "bandwidth") ?? "";
    const startNumber = Number(attribute(template, "startNumber") ?? 1);
    const time = Number(xml.match(/<(?:[\w.-]+:)?S\b[^>]*\bt=["'](\d+)["']/i)?.[1]);
    let result = mediaTemplate.replace(/\$\$/g, "\u0000");
    result = result.replace(/\$RepresentationID\$/g, id).replace(/\$Bandwidth\$/g, bandwidth);
    result = result.replace(/\$Number(?:%0(\d+)d)?\$/g, (_match, digits?: string) => {
      const number = String(Number.isFinite(startNumber) ? startNumber : 1);
      return digits ? number.padStart(Number(digits), "0") : number;
    });
    if (Number.isFinite(time)) result = result.replace(/\$Time\$/g, String(time));
    if (result.includes("$") || result.includes("\u0000")) return null;
    return result;
  }
  return null;
}

async function checkDashManifest(video: VideoSourceForCheck, manifestUrl: URL, xml: string, origin: string): Promise<VideoSourceCheck> {
  if (!/<(?:[\w.-]+:)?MPD\b/i.test(xml) || !/<\/(?:[\w.-]+:)?MPD\s*>/i.test(xml)) return { status: "broken", reason: "Invalid DASH manifest" };
  const reference = firstDashSegment(xml);
  const baseText = elementText(xml, "BaseURL");
  const hasSegmentBase = /<(?:[\w.-]+:)?SegmentBase\b/i.test(xml);
  if (!reference && !(baseText && hasSegmentBase)) return { status: "working", reason: "Valid DASH manifest; media template is not directly probeable" };
  try {
    const baseUrl = baseText ? new URL(baseText, manifestUrl) : manifestUrl;
    const targetUrl = reference ? new URL(reference, baseUrl) : baseUrl;
    if (targetUrl.protocol !== "https:") return { status: "internal", reason: "DASH resource did not use HTTPS" };
    const token = await createMediaResourceToken(video.id, video.video_url, baseUrl.toString(), targetUrl.toString());
    const proxyUrl = new URL("/api/media-proxy", origin);
    proxyUrl.searchParams.set("resource", token);
    const outcome = await probeProxyResource(proxyUrl, "bytes=0-1023");
    if (outcome.status === "broken" && reference && !/^https:\/\//i.test(reference)) {
      return { status: "temporary", reason: "Relative DASH media reference could not be verified" };
    }
    if (outcome.status === "working") return { status: "working", reason: "DASH manifest and media resource are accessible" };
    return outcome;
  } catch {
    return { status: "internal", reason: "DASH source check could not be prepared safely" };
  }
}

async function checkOnce(video: VideoSourceForCheck, origin: string): Promise<VideoSourceCheck> {
  const sourceType = detectSourceType(video.video_url);
  const range = sourceType === "hls" || sourceType === "dash" ? undefined : "bytes=0-65535";
  const rootUrl = new URL(await createVideoPlaybackUrl(video.id), origin);
  const root = await requestProxy(rootUrl, range);
  if ("failure" in root) return root.failure;
  const responseFailure = await classifyHttpFailure(root.response);
  if (responseFailure) return responseFailure;
  const mime = (root.response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  const detectedType = detectSourceType(video.video_url, mime);

  if (detectedType === "hls") {
    const text = await readManifest(root.response);
    return typeof text === "string" ? checkHlsPlaylist(rootUrl, text, origin) : text;
  }
  if (detectedType === "dash") {
    const text = await readManifest(root.response);
    return typeof text === "string" ? checkDashManifest(video, new URL(video.video_url), text, origin) : text;
  }
  if (detectedType === "mp4" || detectedType === "webm") {
    if (!validRangeResponse(root.response)) return { status: "temporary", reason: "Source returned an invalid byte-range response" };
    const prefix = await readPrefix(root.response, MEDIA_PREFIX_BYTES);
    const rangeNote = root.response.status === 200 ? " (range request ignored)" : "";
    if (detectedType === "mp4" && hasMp4Signature(prefix)) return { status: "working", reason: `MP4 media is accessible${rangeNote}` };
    if (detectedType === "webm" && hasWebmSignature(prefix)) return { status: "working", reason: `WebM media is accessible${rangeNote}` };
    if ((detectedType === "mp4" && (mime === "video/mp4" || mime === "application/mp4")) || (detectedType === "webm" && mime === "video/webm")) {
      return { status: "temporary", reason: "Video response signature could not be confirmed" };
    }
    return { status: "broken", reason: prefix.length ? "Response is not valid media data" : "Empty media response" };
  }

  const prefix = await readPrefix(root.response, MEDIA_PREFIX_BYTES);
  const prefixText = prefix.toString("utf8");
  if (/^\s*#EXTM3U/.test(prefixText)) return checkHlsPlaylist(rootUrl, prefixText, origin);
  if (/<(?:[\w.-]+:)?MPD\b/i.test(prefixText)) return checkDashManifest(video, new URL(video.video_url), prefixText, origin);
  if (hasMp4Signature(prefix)) return { status: "working", reason: "MP4 media is accessible" };
  if (hasWebmSignature(prefix)) return { status: "working", reason: "WebM media is accessible" };
  if (/^video\//.test(mime) || mime === "application/octet-stream") return { status: "temporary", reason: "Media format could not be confirmed" };
  return { status: "broken", reason: "Unsupported or invalid media response" };
}

function waitBeforeRetry() {
  return new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

export async function checkVideoSourceWithRetry(video: VideoSourceForCheck, origin: string): Promise<VideoSourceCheck> {
  let first: VideoSourceCheck;
  try { first = await checkOnce(video, origin); }
  catch (error) {
    if (error instanceof MediaReadError) first = { status: "temporary", reason: "Media response was interrupted" };
    else return { status: "internal", reason: "Media check failed unexpectedly" };
  }
  if (first.status === "working" || first.status === "internal") return first;

  await waitBeforeRetry();
  let second: VideoSourceCheck;
  try { second = await checkOnce(video, origin); }
  catch (error) {
    if (error instanceof MediaReadError) second = { status: "temporary", reason: "Media response was interrupted" };
    else return { status: "internal", reason: "Media check failed unexpectedly" };
  }
  if (second.status === "internal") return second;
  if (second.status === "working") return { status: "recovered", reason: "Recovered on retry" };
  if (first.status === "broken" && second.status === "broken") return second;
  return { status: "temporary", reason: second.reason };
}
