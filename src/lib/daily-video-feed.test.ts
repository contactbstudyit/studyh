// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { buildDailyVideoFeed } from "@/lib/daily-video-feed";

function makeVideo(index: number, createdAt: string, views: number) {
  return { id: `video-${index}`, created_at: createdAt, views };
}

describe("daily video feed", () => {
  test("is stable during a day and rotates when the daily seed changes", () => {
    const videos = Array.from({ length: 40 }, (_, index) => makeVideo(index, `2026-08-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`, index * 91));
    const first = buildDailyVideoFeed(videos, "2026-10-01", "edu-category-id").map((video) => video.id);
    const refresh = buildDailyVideoFeed(videos, "2026-10-01", "edu-category-id").map((video) => video.id);
    const nextDay = buildDailyVideoFeed(videos, "2026-10-02", "edu-category-id").map((video) => video.id);
    expect(refresh).toEqual(first);
    expect(nextDay).not.toEqual(first);
    expect(new Set(first).size).toBe(videos.length);
  });

  test("places a newly published video at the top and uses its real views for the top pool", () => {
    const older = Array.from({ length: 32 }, (_, index) => makeVideo(index, `2026-08-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`, 1000 - index));
    const newest = makeVideo(100, "2026-10-01T09:00:00.000Z", 0);
    const feed = buildDailyVideoFeed([newest, ...older], "2026-10-01", "edu-category-id");
    expect(feed[0]?.id).toBe(newest.id);
    expect(new Set(feed.map((video) => video.id)).size).toBe(feed.length);
    expect(feed[1]?.views).toBeGreaterThan(0);
  });

  test("uses category ID as part of the seed", () => {
    const videos = Array.from({ length: 32 }, (_, index) => makeVideo(index, `2026-08-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`, index * 17));
    const edu = buildDailyVideoFeed(videos, "2026-10-01", "edu-category-id").map((video) => video.id);
    const ai = buildDailyVideoFeed(videos, "2026-10-01", "ai-category-id").map((video) => video.id);
    expect(ai).not.toEqual(edu);
  });
});
