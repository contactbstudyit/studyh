import { createHash } from "node:crypto";

export type DailyFeedItem = { id: string; created_at: string; views: number };
const RECENT_DAYS = 7;

export function dailyOrder<T extends DailyFeedItem>(items: T[], seed: string) {
  const score = (item: T) => createHash("sha256").update(`${seed}:${item.id}`).digest("hex");
  return [...items].sort((left, right) => score(left).localeCompare(score(right)) || left.id.localeCompare(right.id));
}

export function buildDailyVideoFeed<T extends DailyFeedItem>(videos: T[], date: string, categoryId: string | null): T[] {
  if (videos.length < 2) return videos;
  const seed = `${date}:${categoryId ?? "all"}`;
  const dayStart = new Date(`${date}T00:00:00.000Z`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const recentStart = dayStart - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const target = Math.ceil(videos.length / 4);
  const created = (video: DailyFeedItem) => Date.parse(video.created_at) || 0;

  const newToday = videos.filter((video) => created(video) >= dayStart && created(video) < dayEnd);
  const recent = videos.filter((video) => created(video) >= recentStart && !newToday.some((item) => item.id === video.id));
  const recentCapacity = Math.min(videos.length, Math.max(target, newToday.length));
  const recentPool = [
    ...dailyOrder(newToday, `${seed}:new`),
    ...dailyOrder(recent, `${seed}:recent`),
  ].slice(0, recentCapacity);
  if (recentPool.length < target) {
    const selected = new Set(recentPool.map((video) => video.id));
    const fill = dailyOrder(videos.filter((video) => !selected.has(video.id)).sort((left, right) => created(right) - created(left)), `${seed}:recent-fill`);
    recentPool.push(...fill.slice(0, target - recentPool.length));
  }

  const used = new Set(recentPool.map((video) => video.id));
  const remaining = videos.filter((video) => !used.has(video.id));
  const topCandidates = [...remaining].sort((left, right) => right.views - left.views || created(right) - created(left)).slice(0, Math.min(remaining.length, target * 3));
  const topPool = dailyOrder(topCandidates, `${seed}:top-viewed`).slice(0, target);
  for (const video of topPool) used.add(video.id);

  const olderCandidates = videos.filter((video) => !used.has(video.id)).sort((left, right) => created(left) - created(right)).slice(0, target * 3);
  const olderPool = dailyOrder(olderCandidates, `${seed}:older`).slice(0, target);
  for (const video of olderPool) used.add(video.id);

  const otherPool = dailyOrder(videos.filter((video) => !used.has(video.id)), `${seed}:rotation`);
  const pools = [recentPool, topPool, olderPool, otherPool];
  const positions = pools.map(() => 0);
  const feed: T[] = [];
  while (feed.length < videos.length) {
    let added = false;
    for (let index = 0; index < pools.length; index++) {
      const candidate = pools[index][positions[index]];
      if (!candidate) continue;
      feed.push(candidate);
      positions[index]++;
      added = true;
    }
    if (!added) break;
  }
  return feed;
}
