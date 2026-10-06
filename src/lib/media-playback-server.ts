const ROOT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const RESOURCE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function getSigningSecret(): string {
  const secret = process.env.MEDIA_PROXY_SECRET;

  if (!secret) {
    throw new Error("Server-side media relay signing is not configured");
  }

  return secret;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    base64 + "=".repeat((4 - (base64.length % 4)) % 4);

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function stringToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    stringToBytes(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
}

async function createHmacSignature(
  secret: string,
  value: string,
): Promise<string> {
  const key = await importHmacKey(secret);

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    stringToBytes(value),
  );

  return base64UrlEncode(new Uint8Array(signature));
}

export async function createVideoPlaybackUrl(
  videoId: string,
): Promise<string> {
  const expires = Date.now() + ROOT_TOKEN_TTL_MS;
  const secret = getSigningSecret();

  const signature = await createHmacSignature(
    secret,
    `${videoId}:${expires}`,
  );

  const params = new URLSearchParams({
    video: videoId,
    expires: String(expires),
    sig: signature,
  });

  return `/api/media-proxy?${params.toString()}`;
}

export async function verifyVideoPlaybackToken(
  videoId: string,
  expiresValue: string,
  signature: string,
): Promise<boolean> {
  try {
    const expires = Number(expiresValue);

    if (
      !Number.isSafeInteger(expires) ||
      expires < Date.now() ||
      expires > Date.now() + ROOT_TOKEN_TTL_MS + 60_000
    ) {
      return false;
    }

    const expected = await createHmacSignature(
      getSigningSecret(),
      `${videoId}:${expires}`,
    );

    if (signature.length !== expected.length) {
      return false;
    }

    let difference = 0;

    for (let i = 0; i < expected.length; i++) {
      difference |=
        expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }

    return difference === 0;
  } catch {
    return false;
  }
}

async function deriveEncryptionKey(
  secret: string,
): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    stringToBytes(`ideavo-media-resource-v1:${secret}`),
  );

  return crypto.subtle.importKey(
    "raw",
    hash,
    {
      name: "AES-GCM",
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function createMediaResourceToken(
  videoId: string,
  source: string,
  base: string,
  url: string,
): Promise<string> {
  const secret = getSigningSecret();

  const iv = crypto.getRandomValues(
    new Uint8Array(12),
  );

  const payload = stringToBytes(
    JSON.stringify({
      videoId,
      source,
      base,
      url,
      expires: Date.now() + RESOURCE_TOKEN_TTL_MS,
    }),
  );

  const key = await deriveEncryptionKey(secret);

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    payload,
  );

  const encryptedBytes = new Uint8Array(encrypted);

  const output = new Uint8Array(
    iv.length + encryptedBytes.length,
  );

  output.set(iv, 0);
  output.set(encryptedBytes, iv.length);

  return base64UrlEncode(output);
}

export async function readMediaResourceToken(
  token: string,
): Promise<{
  videoId: string;
  source: string;
  base: string;
  url: string;
  expires: number;
} | null> {
  try {
    const bytes = base64UrlDecode(token);

    if (bytes.length < 29 || bytes.length > 8192) {
      return null;
    }

    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);

    const key = await deriveEncryptionKey(
      getSigningSecret(),
    );

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      ciphertext,
    );

    const payload = new TextDecoder().decode(
      decrypted,
    );

    const parsed = JSON.parse(payload) as {
      videoId?: unknown;
      source?: unknown;
      base?: unknown;
      url?: unknown;
      expires?: unknown;
    };

    if (
      typeof parsed.videoId !== "string" ||
      typeof parsed.source !== "string" ||
      typeof parsed.base !== "string" ||
      typeof parsed.url !== "string" ||
      typeof parsed.expires !== "number"
    ) {
      return null;
    }

    if (
      !Number.isSafeInteger(parsed.expires) ||
      parsed.expires < Date.now()
    ) {
      return null;
    }

    return {
      videoId: parsed.videoId,
      source: parsed.source,
      base: parsed.base,
      url: parsed.url,
      expires: parsed.expires,
    };
  } catch {
    return null;
  }
}
