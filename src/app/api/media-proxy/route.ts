import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createMediaResourceToken, readMediaResourceToken, verifyVideoPlaybackToken } from "@/lib/media-playback-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REDIRECTS = 5;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_RESPONSE_HEADERS = [
  "accept-ranges", "content-length", "content-range", "content-type", "etag", "last-modified",
] as const;

type ResolvedAddress = { address: string; family: 4 | 6 };
type UpstreamResult = { response: IncomingMessage; finalUrl: URL };

function getSigningSecret() {
  const secret = process.env.MEDIA_PROXY_SECRET;
  return secret ? Buffer.from(secret, "utf8") : null;
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168) && (b !== 0 || c === 0)) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}

function expandIpv6(address: string): number[] | null {
  let value = address.toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const colon = value.lastIndexOf(":");
    const ipv4 = value.slice(colon + 1).split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    value = `${value.slice(0, colon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const segments = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
  if (segments.length !== 8 || segments.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return segments.map((part) => Number.parseInt(part, 16));
}

function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !isPrivateIpv4(address);
  if (family !== 6) return false;
  const segments = expandIpv6(address);
  if (!segments) return false;
  const first = segments[0];
  const second = segments[1];
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && (second === 0 || second === 0x0db8 || (second & 0xfff0) === 0x0010 || (second & 0xff00) === 0x0200)) return false;
  if (first === 0x2002) return false;
  return true;
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function parsePublicHttpsUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid external media URL"); }
  if (url.protocol !== "https:") throw new Error("Only HTTPS media sources are permitted");
  if (url.username || url.password) throw new Error("Credentials in media URLs are not permitted");
  if (url.port && url.port !== "443") throw new Error("Only standard HTTPS port 443 is permitted");
  const host = normalizeHostname(url.hostname);
  if (!host || host === "localhost" || /\.(localhost|local|internal|test|invalid|example)$/.test(host)) throw new Error("Internal hostnames are not permitted");
  const ipFamily = isIP(host);
  if (ipFamily && !isPublicAddress(host)) throw new Error("Private or reserved IP addresses are not permitted");
  return url;
}

async function resolvePublicAddress(hostname: string): Promise<ResolvedAddress> {
  const host = normalizeHostname(hostname);
  const family = isIP(host);
  if (family) {
    if (!isPublicAddress(host)) throw new Error("Private or reserved IP addresses are not permitted");
    return { address: host, family: family as 4 | 6 };
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error("Media host resolves to a private or reserved address");
  const selected = addresses.find((item) => item.family === 4) ?? addresses[0];
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function proxySignature(secret: Buffer, source: string, base: string, target: string) {
  return createHmac("sha256", secret).update(JSON.stringify([source, base, target])).digest("base64url");
}

function verifySignature(secret: Buffer, provided: string, source: string, base: string, target: string) {
  const expected = Buffer.from(proxySignature(secret, source, base, target));
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function makeProxyUrl(requestUrl: string, source: string, base: string, target: string, secret: Buffer, videoId?: string) {
  const proxyUrl = new URL("/api/media-proxy", requestUrl);
  if (videoId) proxyUrl.searchParams.set("resource", await createMediaResourceToken(videoId, source, base, target));
  else {
    proxyUrl.searchParams.set("source", source);
    proxyUrl.searchParams.set("base", base);
    proxyUrl.searchParams.set("url", target);
    proxyUrl.searchParams.set("sig", proxySignature(secret, source, base, target));
  }
  return `${proxyUrl.pathname}${proxyUrl.search}`;
}

function getApplicationOrigin(request: NextRequest) {
  return new URL(request.url).origin;
}

async function rewriteManifest(body: string, applicationOrigin: string, source: string, manifestUrl: string, secret: Buffer, videoId?: string) {
  const rewrite = async (raw: string) => {
    const value = raw.trim();
    try {
      const target = new URL(value, manifestUrl);
      if (target.protocol !== "http:" && target.protocol !== "https:") return raw;
      if (target.protocol !== "https:") throw new Error("Insecure playlist resource URL");
      return await makeProxyUrl(applicationOrigin, source, manifestUrl, target.toString(), secret, videoId);
    } catch (error) {
      if (error instanceof TypeError) throw new Error("Invalid URL in external HLS manifest");
      throw error;
    }
  };

  const output: string[] = [];
  for (const line of body.split(/(\r?\n)/)) {
    if (!line || /^\r?\n$/.test(line)) { output.push(line); continue; }
    if (line.trimStart().startsWith("#")) {
      const matches = [...line.matchAll(/URI=(['"])(.*?)\1/gi)];
      if (!matches.length) { output.push(line); continue; }
      const replacements = await Promise.all(matches.map(async (match) => {
        const quote = match[1];
        const uri = match[2];
        return `URI=${quote}${await rewrite(uri)}${quote}`;
      }));
      let rewritten = "";
      let cursor = 0;
      for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
        const match = matches[matchIndex];
        const offset = match.index ?? cursor;
        rewritten += line.slice(cursor, offset) + replacements[matchIndex];
        cursor = offset + match[0].length;
      }
      output.push(rewritten + line.slice(cursor));
      continue;
    }
    output.push(line.trim() ? await rewrite(line.replace(/^\s*([^\s].*?)\s*$/, "$1")) : line);
  }
  return output.join("");
}

function responseHeaders(request: NextRequest, upstream?: IncomingMessage, overrides?: HeadersInit) {
  const headers = new Headers(overrides);
  const origin = request.headers.get("origin");
  const appOrigin = getApplicationOrigin(request);
  headers.set("Access-Control-Allow-Origin", origin === appOrigin ? origin : appOrigin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range, If-Range, Content-Type");
  headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified");
  headers.set("Cache-Control", "no-store");
  if (upstream) {
    for (const name of ALLOWED_RESPONSE_HEADERS) {
      const value = upstream.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
  }
  return headers;
}

function errorResponse(request: NextRequest, message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: responseHeaders(request, undefined, { "Cache-Control": "no-store" }) });
}

async function requestUpstream(url: URL, request: NextRequest, redirects = 0): Promise<UpstreamResult> {
  if (redirects > MAX_REDIRECTS) throw new Error("External media source redirected too many times");
  const safeUrl = parsePublicHttpsUrl(url.toString());
  const resolved = await resolvePublicAddress(safeUrl.hostname);
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const range = request.headers.get("range");
  if (range && (range.length > 256 || !/^bytes=\d*-\d*(?:,\d*-\d*)*$/.test(range))) throw new Error("Invalid byte range");
  const headers: Record<string, string> = {
    Accept: request.headers.get("accept") || "*/*",
    "Accept-Encoding": "identity",
    "User-Agent": "Mozilla/5.0 (compatible; ExternalMediaRelay/1.0)",
  };
  if (range) headers.Range = range;
  const ifRange = request.headers.get("if-range");
  if (ifRange) headers["If-Range"] = ifRange;

  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const upstreamRequest = httpsRequest({
      protocol: "https:",
      hostname: safeUrl.hostname,
      port: 443,
      servername: normalizeHostname(safeUrl.hostname),
      method,
      path: `${safeUrl.pathname}${safeUrl.search}`,
      headers,
      lookup: (_host, options, callback) => {
        if (typeof options === "object" && options?.all) callback(null, [{ address: resolved.address, family: resolved.family }]);
        else callback(null, resolved.address, resolved.family);
      },
    }, resolve);
    const abort = () => upstreamRequest.destroy(new Error("Client disconnected"));
    request.signal.addEventListener("abort", abort, { once: true });
    upstreamRequest.setTimeout(20_000, () => upstreamRequest.destroy(new Error("External media request timed out")));
    upstreamRequest.once("error", (error) => {
      request.signal.removeEventListener("abort", abort);
      reject(error);
    });
    upstreamRequest.once("response", () => request.signal.removeEventListener("abort", abort));
    upstreamRequest.end();
  });

  const status = response.statusCode ?? 502;
  const location = response.headers.location;
  if ([301, 302, 303, 307, 308].includes(status) && location) {
    response.resume();
    const redirected = new URL(location, safeUrl);
    parsePublicHttpsUrl(redirected.toString());
    return requestUpstream(redirected, request, redirects + 1);
  }
  return { response, finalUrl: safeUrl };
}

async function readManifest(response: IncomingMessage) {
  const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase();
  let stream: NodeJS.ReadableStream = response;
  if (encoding === "gzip") stream = response.pipe(createGunzip());
  else if (encoding === "br") stream = response.pipe(createBrotliDecompress());
  else if (encoding === "deflate") stream = response.pipe(createInflate());
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const part of stream as AsyncIterable<Buffer | string>) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    total += chunk.length;
    if (total > MAX_MANIFEST_BYTES) throw new Error("External HLS manifest exceeded the size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isManifest(url: URL, contentType: string) {
  return /\.m3u8?$/i.test(url.pathname) || /mpegurl|m3u/i.test(contentType);
}

function isSuccessful(status: number) { return status >= 200 && status < 300; }

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== getApplicationOrigin(request)) return errorResponse(request, "Cross-origin media proxy requests are not allowed", 403);
  return new NextResponse(null, { status: 204, headers: responseHeaders(request) });
}

export async function GET(request: NextRequest) { return relay(request); }
export async function HEAD(request: NextRequest) { return relay(request); }

async function relay(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== getApplicationOrigin(request)) return errorResponse(request, "Cross-origin media proxy requests are not allowed", 403);
  const params = request.nextUrl.searchParams;
  const videoToken = params.get("video");
  const resourceToken = params.get("resource");
  const secret = getSigningSecret();
  if (!secret) return errorResponse(request, "Secure media relay signing is not configured", 503);
  let source: string | null = null;
  let targetRaw: string | null = null;
  let base: string | null = null;
  let signature: string | null = null;
  let opaqueVideoId: string | null = null;
  let rootRequest = false;

  if (videoToken) {
    const expires = params.get("expires") ?? "";
    signature = params.get("sig");
    if (!UUID_PATTERN.test(videoToken) || !signature || !await verifyVideoPlaybackToken(videoToken, expires, signature)) return errorResponse(request, "Invalid or expired playback token", 403);
    try {
      const supabase = await createClient();
      const { data: video, error } = await supabase.from("videos").select("video_url").eq("id", videoToken).eq("published", true).maybeSingle();
      if (error) return errorResponse(request, "Could not verify published video", 502);
      if (!video) return errorResponse(request, "Video is not available", 404);
      source = video.video_url; targetRaw = video.video_url; base = video.video_url;
      opaqueVideoId = videoToken; rootRequest = true;
    } catch { return errorResponse(request, "Could not resolve playback source", 502); }
  } else if (resourceToken) {
    const resource = await readMediaResourceToken(resourceToken);
    if (!resource || !UUID_PATTERN.test(resource.videoId)) return errorResponse(request, "Invalid or expired media resource token", 403);
    opaqueVideoId = resource.videoId;
    source = resource.source; base = resource.base; targetRaw = resource.url;
  } else {
    source = params.get("source");
    targetRaw = params.get("url");
    base = params.get("base") || source;
    signature = params.get("sig");
  }
  if (!source || !targetRaw || !base) return errorResponse(request, "Missing media source parameters", 400);
  let sourceUrl: URL;
  let targetUrl: URL;
  let baseUrl: URL;
  try {
    sourceUrl = parsePublicHttpsUrl(source);
    targetUrl = parsePublicHttpsUrl(targetRaw);
    baseUrl = parsePublicHttpsUrl(base);
  } catch (error) {
    return errorResponse(request, error instanceof Error ? error.message : "Invalid external media URL", 400);
  }

  if (!opaqueVideoId) {
    rootRequest = source === targetRaw && base === source && !signature;
    if (!rootRequest && (!signature || !verifySignature(secret, signature, source, base, targetRaw))) return errorResponse(request, "Invalid or expired media resource signature", 403);
  }

  try {
    if (rootRequest && !opaqueVideoId) {
      const supabase = await createClient();
      const { data: video, error } = await supabase.from("videos").select("id").eq("video_url", source).limit(1).maybeSingle();
      if (error) return errorResponse(request, "Could not verify the published media source", 502);
      if (!video) return errorResponse(request, "Media source is not available in the public library", 404);
    }

    const { response, finalUrl } = await requestUpstream(targetUrl, request);
    const status = response.statusCode ?? 502;
    const contentType = String(response.headers["content-type"] ?? "application/octet-stream");
    if (isSuccessful(status) && isManifest(finalUrl, contentType)) {
      const manifest = await readManifest(response);
      const rewritten = await rewriteManifest(manifest, getApplicationOrigin(request), source, finalUrl.toString(), secret, opaqueVideoId ?? undefined);
      const body = request.method === "HEAD" ? null : rewritten;
      const headers = responseHeaders(request, undefined, {
        "Content-Type": contentType.includes("mpegurl") || contentType.includes("m3u") ? contentType : "application/vnd.apple.mpegurl",
        "Content-Length": String(Buffer.byteLength(rewritten)),
        "Accept-Ranges": String(response.headers["accept-ranges"] ?? "none"),
        "Cache-Control": "no-store",
      });
      return new Response(body, { status, headers });
    }

    const headers = responseHeaders(request, response);
    if (request.method === "HEAD") {
      response.resume();
      return new Response(null, { status, headers });
    }
    return new Response(Readable.toWeb(response) as ReadableStream, { status, headers });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error("[media-proxy] relay failed", { sourceHost: sourceUrl.host, targetHost: targetUrl.host, errorType: error instanceof Error ? error.name : "UnknownError" });
    return errorResponse(request, "External media relay failed", 502);
  }
}
