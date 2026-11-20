import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type CloudflareVideoAccountRecord = {
  id: string;
  display_name: string;
  account_id: string;
  access_key_id_ciphertext: string;
  secret_access_key_ciphertext: string;
  endpoint: string;
  bucket_name: string;
  public_url: string;
  is_default: boolean;
  is_active: boolean;
};

function encryptionKey() {
  const encoded = process.env.CLOUDFLARE_ACCOUNT_ENCRYPTION_KEY;
  if (!encoded) throw new Error("CLOUDFLARE_ACCOUNT_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("CLOUDFLARE_ACCOUNT_ENCRYPTION_KEY must encode exactly 32 random bytes as base64");
  return key;
}

export function encryptCloudflareCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptCloudflareCredential(value: string) {
  const [iv, tag, ciphertext, extra] = value.split(".");
  if (!iv || !tag || !ciphertext || extra) throw new Error("Stored Cloudflare credential is malformed");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function publicCloudflareVideoAccount(account: CloudflareVideoAccountRecord) {
  return {
    id: account.id,
    name: account.display_name,
    accountId: account.account_id,
    endpoint: account.endpoint,
    bucketName: account.bucket_name,
    publicUrl: account.public_url,
    isDefault: account.is_default,
    isActive: account.is_active,
  };
}
