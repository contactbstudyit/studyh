"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clapperboard, Clock3, Command, Filter, Play, Search } from "lucide-react";
import Link from "next/link";
import { useVideos } from "@/hooks/use-library";
import type { VideoSort } from "@/hooks/use-library";
import type { PublicCategory } from "@/lib/category-routes";
import VideoPagination from "@/components/video-pagination";
import gridStyles from "@/components/public-video-grid.module.css";
import PublicViewCount from "@/components/public-view-count";

const PUBLIC_PAGE_SIZE = 15;

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

export default function CategoryVideos({ category, slug, initialSort = "latest", initialPage = 1, initialQuery = "", initialFilterOpen = false, focusSearchOnMount = false }: { category: PublicCategory; slug: string; initialSort?: string; initialPage?: number; initialQuery?: string; initialFilterOpen?: boolean; focusSearchOnMount?: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<VideoSort>(() => readSort(initialSort));
  const [page, setPage] = useState(initialPage);
  const [randomSeed, setRandomSeed] = useState(1);
  const [filterOpen, setFilterOpen] = useState(initialFilterOpen);
  const filterRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const videosHook = useVideos({ categoryId: category.id, search: query, admin: false, sort, pageNumber: page, pageSize: PUBLIC_PAGE_SIZE, dailyFeed: true });
  const displayedVideos = useMemo(() => sort === "random"
    ? [...videosHook.videos].sort((left, right) => randomOrderKey(left.id, randomSeed) - randomOrderKey(right.id, randomSeed))
    : videosHook.videos, [videosHook.videos, sort, randomSeed]);

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      setSort(readSort(params.get("sort")));
      setQuery(params.get("q") ?? "");
      const requestedPage = Number.parseInt(params.get("page") ?? "1", 10);
      setPage(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    };
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
  useEffect(() => {
    if (!focusSearchOnMount) return;
    searchInputRef.current?.focus();
    const url = new URL(window.location.href);
    url.searchParams.delete("focusSearch");
    window.history.replaceState(null, "", url);
  }, [focusSearchOnMount]);

  function selectSort(next: VideoSort) {
    const option = sortOptions.find((item) => item.value === next);
    if (!option?.supported) return;
    setSort(next);
    if (next === "random") setRandomSeed(Math.floor(Math.random() * 0x7fffffff));
    const url = new URL(window.location.href);
    if (next === "latest") url.searchParams.delete("sort");
    else url.searchParams.set("sort", next);
    url.searchParams.delete("openFilter");
    url.searchParams.delete("focusSearch");
    url.searchParams.delete("page");
    window.history.replaceState(null, "", url);
    setPage(1);
    setFilterOpen(false);
  }

  function changeSearch(value: string) {
    setQuery(value); setPage(1);
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set("q", value.trim()); else url.searchParams.delete("q");
    url.searchParams.delete("focusSearch");
    url.searchParams.delete("openFilter");
    url.searchParams.delete("page");
    window.history.replaceState(null, "", url);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    const url = new URL(window.location.href);
    if (nextPage > 1) url.searchParams.set("page", String(nextPage)); else url.searchParams.delete("page");
    window.history.pushState(null, "", url);
  }

  const totalPages = Math.ceil((videosHook.totalCount ?? 0) / PUBLIC_PAGE_SIZE);
  useEffect(() => {
    if (videosHook.totalCount === null) return;
    const lastPage = Math.max(1, Math.ceil(videosHook.totalCount / PUBLIC_PAGE_SIZE));
    if (page > lastPage) changePage(lastPage);
  }, [videosHook.totalCount, page]);

  return <main className="site-shell">
    <header className="topbar category-topbar">
      <div className="header-actions category-header-actions">
        <Link className="category-reels-link" href={`/category/${encodeURIComponent(slug)}/reels`} aria-label={`Watch ${category.name} reels`} title="Reels"><Clapperboard size={15} aria-hidden="true"/></Link>
        <label className="search-box"><Search size={16}/><input ref={searchInputRef} value={query} onChange={(event) => changeSearch(event.target.value)} placeholder="Search videos" aria-label={`Search ${category.name} videos`}/><kbd><Command size={10}/> K</kbd></label>
        <div className="sort-control" ref={filterRef}>
          <button className="sort-trigger" type="button" aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><Filter size={15}/><span>Filter</span></button>
          {filterOpen && <div className="sort-popover" role="menu" aria-label="Sort videos">{sortOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={sort === option.value} disabled={!option.supported} title={option.supported ? undefined : "Likes and ratings are not stored for videos"} className={`sort-option ${sort === option.value ? "selected" : ""} ${!option.supported ? "unavailable" : ""}`} onClick={() => selectSort(option.value)}><span>{option.label}</span>{sort === option.value && <Check size={14}/>}</button>)}<p className="sort-note">Likes and ratings are not available in this library.</p></div>}
        </div>
      </div>
    </header>
    <section className="collection section-wrap category-results-page" id="top">
      {videosHook.loading && videosHook.videos.length === 0 ? <div className={`video-grid public-video-grid ${gridStyles.singleColumn} skeleton-grid`} role="status" aria-label={`Loading ${category.name} videos`}>{Array.from({ length: 6 }, (_, index) => <article className="video-card skeleton-card" key={index}><div className="skeleton-thumbnail"/><div className="skeleton-title"><span/><span/></div></article>)}</div> : <div className={`video-grid public-video-grid ${gridStyles.singleColumn}`}>{displayedVideos.map((video) => <article className="video-card" key={video.id}><Link className="thumbnail-button" href={`/watch/${video.id}`} aria-label={`Watch ${video.title}`}><img loading="lazy" src={video.thumbnail_url || "/film-placeholder.svg"} alt=""/><span className="thumb-shade"/><span className="play-disc"><Play size={17} fill="currentColor"/></span>{video.duration && <span className="duration"><Clock3 size={11}/>{video.duration}</span>}</Link><Link className="card-title" href={`/watch/${video.id}`}>{video.title}</Link><PublicViewCount count={video.display_views ?? 0} className="card-view-count"/>{video.description && <p className="card-description">{video.description}</p>}</article>)}</div>}
      {!videosHook.loading && videosHook.totalCount === 0 && <div className="empty-state"><Search size={22}/><strong>No videos in {category.name} yet</strong><span>Check back later for new videos.</span></div>}
      <VideoPagination page={page} totalPages={totalPages} loading={videosHook.loading} onPageChange={changePage}/>
    </section>
  </main>;
}
