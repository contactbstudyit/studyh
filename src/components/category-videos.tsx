"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, Command, Filter, Play, Search, X } from "lucide-react";
import Link from "next/link";
import { useCategories, useVideos } from "@/hooks/use-library";
import type { VideoSort, VideoRecord } from "@/hooks/use-library";
import { getCategorySlug, slugifyCategory } from "@/lib/category-slug";
import type { PublicCategory } from "@/lib/category-routes";
import { VideoPlayer } from "@/components/video-player";

const sortOptions: { value: VideoSort; label: string; supported: boolean }[] = [
  { value: "latest", label: "Latest", supported: true },
  { value: "oldest", label: "Oldest", supported: true },
  { value: "most-watched", label: "Most Watched", supported: true },
  { value: "least-watched", label: "Least Watched", supported: true },
  { value: "most-liked", label: "Most Liked", supported: false },
  { value: "highest-rated", label: "Highest Rated", supported: false },
  { value: "lowest-rated", label: "Lowest Rated", supported: false },
  { value: "a-z", label: "A–Z", supported: true },
  { value: "z-a", label: "Z–A", supported: true },
  { value: "random", label: "Random", supported: true },
];

function readSort(value?: string | null): VideoSort {
  return sortOptions.some((option) => option.value === value && option.supported) ? value as VideoSort : "latest";
}

function randomOrderKey(value: string, seed: number) {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  return hash;
}

export default function CategoryVideos({ category, initialSort = "latest" }: { category: PublicCategory; initialSort?: string }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<VideoSort>(() => readSort(initialSort));
  const [randomSeed, setRandomSeed] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<VideoRecord | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const categoriesHook = useCategories();
  const videosHook = useVideos({ categoryId: category.id, search: query, admin: false, sort });
  const categories = useMemo(() => categoriesHook.categories, [categoriesHook.categories]);
  const displayedVideos = useMemo(() => sort === "random"
    ? [...videosHook.videos].sort((left, right) => randomOrderKey(left.id, randomSeed) - randomOrderKey(right.id, randomSeed))
    : videosHook.videos, [videosHook.videos, sort, randomSeed]);

  useEffect(() => { if (selected) void videosHook.recordView(selected.id); }, [selected?.id]);
  useEffect(() => {
    const handlePopState = () => setSort(readSort(new URLSearchParams(window.location.search).get("sort")));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  useEffect(() => {
    if (!filterOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setFilterOpen(false); };
    const onPointerDown = (event: PointerEvent) => { if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("pointerdown", onPointerDown); };
  }, [filterOpen]);

  function selectSort(next: VideoSort) {
    const option = sortOptions.find((item) => item.value === next);
    if (!option?.supported) return;
    setSort(next);
    if (next === "random") setRandomSeed(Math.floor(Math.random() * 0x7fffffff));
    const url = new URL(window.location.href);
    if (next === "latest") url.searchParams.delete("sort");
    else url.searchParams.set("sort", next);
    window.history.replaceState(null, "", url);
    setFilterOpen(false);
  }

  const categoryLink = (video: VideoRecord) => {
    const item = categories.find((candidate) => candidate.id === video.category_id);
    const name = video.categories?.name ?? item?.name;
    if (!name) return null;
    const slug = item ? getCategorySlug(item, categories) : slugifyCategory(name);
    return <Link className="card-category-link" href={`/category/${slug}`}>{name}</Link>;
  };

  return <main className="site-shell">
    <header className="topbar category-topbar">
      <div className="header-actions category-header-actions">
        <label className="search-box"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos" aria-label={`Search ${category.name} videos`}/><kbd><Command size={10}/> K</kbd></label>
        <div className="sort-control" ref={filterRef}>
          <button className="sort-trigger" type="button" aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><Filter size={15}/><span>Filter</span></button>
          {filterOpen && <div className="sort-popover" role="menu" aria-label="Sort videos">{sortOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={sort === option.value} disabled={!option.supported} title={option.supported ? undefined : "Likes and ratings are not stored for videos"} className={`sort-option ${sort === option.value ? "selected" : ""} ${!option.supported ? "unavailable" : ""}`} onClick={() => selectSort(option.value)}><span>{option.label}</span>{sort === option.value && <Check size={14}/>}</button>)}<p className="sort-note">Likes and ratings are not available in this library.</p></div>}
        </div>
      </div>
    </header>
    <section className="collection section-wrap" id="top">
      {videosHook.loading && videosHook.videos.length === 0 ? <div className="video-grid skeleton-grid" role="status" aria-label={`Loading ${category.name} videos`}>{Array.from({ length: 6 }, (_, index) => <article className="video-card skeleton-card" key={index}><div className="skeleton-thumbnail"/><div className="skeleton-meta"><span/></div><div className="skeleton-title"><span/><span/></div></article>)}</div> : <div className="video-grid">{displayedVideos.map((video) => <article className="video-card" key={video.id}><button className="thumbnail-button" onClick={() => setSelected(video)} aria-label={`Watch ${video.title}`}><img loading="lazy" src={video.thumbnail_url || "/film-placeholder.svg"} alt=""/><span className="thumb-shade"/><span className="play-disc"><Play size={17} fill="currentColor"/></span>{video.duration && <span className="duration"><Clock3 size={11}/>{video.duration}</span>}</button><div className="card-meta"><span>{categoryLink(video)}</span></div><button className="card-title" onClick={() => setSelected(video)}>{video.title}</button>{video.description && <p className="card-description">{video.description}</p>}</article>)}</div>}
      {!videosHook.loading && videosHook.videos.length === 0 && <div className="empty-state"><Search size={22}/><strong>No videos in {category.name} yet</strong><span>Check back later for new videos.</span></div>}
      {videosHook.hasMore && <div className="pagination"><button onClick={videosHook.loadMore} disabled={videosHook.loading}>{videosHook.loading ? "Loading..." : "Load more videos"}</button></div>}
    </section>
    {selected && <div className="modal-backdrop" role="presentation" onClick={() => setSelected(null)}><section className="watch-modal" role="dialog" aria-modal="true" aria-label={selected.title} onClick={(event) => event.stopPropagation()}><div className="watch-top"><span><span className="live-dot"/> NOW PLAYING</span><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close player"><X size={19}/></button></div><VideoPlayer video={selected}/><div className="watch-info"><div><span className="eyebrow">{selected.categories?.name ?? category.name} · {selected.views.toLocaleString()} views</span><h2>{selected.title}</h2><p>{selected.description}</p></div></div><div className="source-note"><Check size={13}/> Streaming directly from its source. Nothing is stored here.</div></section></div>}
  </main>;
}
