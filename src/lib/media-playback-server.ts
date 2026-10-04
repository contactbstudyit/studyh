import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ROOT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const RESOURCE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function getSigningKey() {
  const secret = process.env.MEDIA_PROXY_SECRET;
  if (!secret) throw new Error("Server-side media relay signing is not configured");
  return Buffer.from(secret, "utf8");
}

function deriveEncryptionKey(secret: Buffer) {
  return createHash("sha256").update("ideavo-media-resource-v1:").update(secret).digest();
}

function rootSignature(secret: Buffer, videoId: string, expires: number) {
  return createHmac("sha256", secret).update(`${videoId}:${expires}`).digest("base64url");
}

export function createVideoPlaybackUrl(videoId: string) {
  const expires = Date.now() + ROOT_TOKEN_TTL_MS;
  const params = new URLSearchParams({ video: videoId, expires: String(expires), sig: rootSignature(getSigningKey(), videoId, expires) });
  return `/api/media-proxy?${params.toString()}`;
}

export function verifyVideoPlaybackToken(videoId: string, expiresValue: string, signature: string) {
  const expires = Number(expiresValue);
  if (!Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + ROOT_TOKEN_TTL_MS + 60_000) return false;
  const expected = Buffer.from(rootSignature(getSigningKey(), videoId, expires));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createMediaResourceToken(videoId: string, source: string, base: string, url: string) {
  const secret = getSigningKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(secret), iv);
  const payload = Buffer.from(JSON.stringify({ videoId, source, base, url, expires: Date.now() + RESOURCE_TOKEN_TTL_MS }));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function readMediaResourceToken(token: string): { videoId: string; source: string; base: string; url: string; expires: number } | null {
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length < 29 || bytes.length > 8192) return null;
    const iv = bytes.subarray(0, 12);
    const tag = bytes.subarray(12, 28);
    const ciphertext = bytes.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", deriveEncryptionKey(getSigningKey()), iv);
    decipher.setAuthTag(tag);
    const payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(payload) as { videoId?: unknown; source?: unknown; base?: unknown; url?: unknown; expires?: unknown };
    if (typeof parsed.videoId !== "string" || typeof parsed.source !== "string" || typeof parsed.base !== "string" || typeof parsed.url !== "string" || typeof parsed.expires !== "number") return null;
    if (!Number.isSafeInteger(parsed.expires) || parsed.expires < Date.now()) return null;
    return { videoId: parsed.videoId, source: parsed.source, base: parsed.base, url: parsed.url, expires: parsed.expires };
  } catch { return null; }
}
