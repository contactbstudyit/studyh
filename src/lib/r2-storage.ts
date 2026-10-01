import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

type R2Configuration = { client: S3Client; bucket: string; publicBaseUrl: URL };
let cachedClient: { key: string; client: S3Client } | null = null;

function getConfiguration(): R2Configuration {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const publicBase = process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;
  const missing = [
    ["CLOUDFLARE_R2_ACCOUNT_ID", accountId],
    ["CLOUDFLARE_R2_ACCESS_KEY_ID", accessKeyId],
    ["CLOUDFLARE_R2_SECRET_ACCESS_KEY", secretAccessKey],
    ["CLOUDFLARE_R2_BUCKET_NAME", bucket],
    ["CLOUDFLARE_R2_PUBLIC_BASE_URL", publicBase],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Persistent R2 thumbnail storage is not configured. Missing server environment variables: ${missing.join(", ")}`);

  let publicBaseUrl: URL;
  try { publicBaseUrl = new URL(publicBase!); } catch { throw new Error("CLOUDFLARE_R2_PUBLIC_BASE_URL must be an HTTPS custom domain"); }
  if (publicBaseUrl.protocol !== "https:" || publicBaseUrl.username || publicBaseUrl.password || publicBaseUrl.search || publicBaseUrl.hash) {
    throw new Error("CLOUDFLARE_R2_PUBLIC_BASE_URL must be a clean HTTPS URL without credentials, query, or fragment");
  }
  publicBaseUrl.pathname = publicBaseUrl.pathname.replace(/\/+$/, "");

  const cacheKey = `${accountId}:${accessKeyId}:${secretAccessKey}:${bucket}`;
  if (!cachedClient || cachedClient.key !== cacheKey) {
    cachedClient?.client.destroy();
    cachedClient = {
      key: cacheKey,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        forcePathStyle: true,
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      }),
    };
  }
  return { client: cachedClient.client, bucket: bucket!, publicBaseUrl };
}

export async function saveGeneratedThumbnail(videoId: string, body: Buffer, contentType: "image/jpeg" | "image/webp") {
  const config = getConfiguration();
  const extension = contentType === "image/webp" ? "webp" : "jpg";
  const key = `video-thumbnails/${videoId}/${randomUUID()}.${extension}`;
  await config.client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentLength: body.byteLength,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return { key, url: `${config.publicBaseUrl.toString().replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}` };
}

export async function deleteGeneratedThumbnail(videoId: string, thumbnailUrl: string) {
  const publicBase = process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;
  if (!publicBase) return false;
  let url: URL;
  let baseUrl: URL;
  try { baseUrl = new URL(publicBase); } catch { return false; }
  try { url = new URL(thumbnailUrl); } catch { return false; }
  if (url.origin !== baseUrl.origin) return false;
  const basePath = baseUrl.pathname.replace(/\/$/, "");
  const pathname = decodeURIComponent(url.pathname);
  const prefix = `${basePath}/video-thumbnails/${videoId}/`;
  if (!pathname.startsWith(prefix)) return false;
  const key = pathname.slice(basePath.length + 1);
  if (!key || key.includes("..") || key.includes("\\")) throw new Error("Invalid generated thumbnail object key");
  const config = getConfiguration();
  await config.client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  return true;
}
