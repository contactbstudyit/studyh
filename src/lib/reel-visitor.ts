"use client";

const STORAGE_KEY = "fansonly-reel-visitor-id";

export function getReelVisitorId() {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}
