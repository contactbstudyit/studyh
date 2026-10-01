import { createHash } from "node:crypto";

export type PublicViewSource = {
  id: string;
  views: number;
  display_view_count: number;
  published_at: string | null;
  created_at: string;
};

const FIRST_GROWTH_DELAY_MS = 48 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function getPublicDisplayViews(video: PublicViewSource, now = new Date()) {
  const base = BigInt(Math.max(5_000, Math.min(30_000, Math.trunc(video.display_view_count || 5_000))));
  const publishedAt = Date.parse(video.published_at ?? video.created_at);
  const elapsedSinceGrowthStart = now.getTime() - publishedAt - FIRST_GROWTH_DELAY_MS;
  const completedMonths = elapsedSinceGrowthStart < 0 ? 0 : Math.min(1_200, Math.floor(elapsedSinceGrowthStart / MONTH_MS));
  let promotion = base;
  for (let month = 1; month <= completedMonths; month++) {
    const hash = createHash("sha256").update(`${video.id}:${month}`).digest().readUInt32BE(0);
    const monthlyBasisPoints = 200 + hash % 301;
    promotion = (promotion * BigInt(10_000 + monthlyBasisPoints) + BigInt(5_000)) / BigInt(10_000);
  }
  const total = promotion + BigInt(Math.max(0, Math.trunc(video.views || 0)));
  return total > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(total);
}
