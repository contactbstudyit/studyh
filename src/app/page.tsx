"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Command, Menu, Play, Search, Settings2 } from "lucide-react";
import Link from "next/link";
import { Category, useCategories, useVideos } from "@/hooks/use-library";
import { getCategorySlug, slugifyCategory } from "@/lib/category-slug";
import VideoPagination from "@/components/video-pagination";
import PublicViewCount from "@/components/public-view-count";
import gridStyles from "@/components/public-video-grid.module.css";

const PUBLIC_PAGE_SIZE = 15;

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [urlReady, setUrlReady] = useState(false);
  const urlInitialized = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const categoriesHook = useCategories();
  const defaultCategory = categoriesHook.categories.find((category) => slugifyCategory(category.name) === "edu");
  useEffect(() => {
    if (categoriesHook.loading) return;
    if (urlInitialized.current) return;
    const params = new URLSearchParams(window.location.search);
    const categorySlug = params.get("category");
    const urlCategory = categorySlug && categorySlug !== "all" ? categoriesHook.categories.find((category) => getCategorySlug(category, categoriesHook.categories) === categorySlug)?.id : null;
    setActiveCategory(categorySlug === "all" ? "" : urlCategory ?? defaultCategory?.id ?? "");
    setQuery(params.get("q") ?? "");
    const requestedPage = Number.parseInt(params.get("page") ?? "1", 10);
    setPage(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    urlInitialized.current = true;
    setUrlReady(true);
  }, [categoriesHook.loading, categoriesHook.categories, defaultCategory?.id]);
  const searchCategoryIds = useMemo(() => categoriesHook.categories.filter((category) => category.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((category) => category.id), [categoriesHook.categories, query]);
  const videosHook = useVideos({ categoryId: activeCategory || undefined, search: query, searchCategoryIds, enabled: urlReady, pageNumber: page, pageSize: PUBLIC_PAGE_SIZE, dailyFeed: true });
  const categories = useMemo(() => categoriesHook.categories, [categoriesHook.categories]);

  useEffect(() => {
    if (!urlReady) return;
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const slug = params.get("category");
      const match = slug && slug !== "all" ? categories.find((category) => getCategorySlug(category, categories) === slug) : null;
      setActiveCategory(slug === "all" ? "" : match?.id ?? defaultCategory?.id ?? "");
      setQuery(params.get("q") ?? "");
      const requestedPage = Number.parseInt(params.get("page") ?? "1", 10);
      setPage(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [urlReady, categories, defaultCategory?.id]);

  function updateHomeUrl(nextPage: number, nextCategory: string, nextQuery: string, replace = true) {
    const url = new URL(window.location.href);
    if (nextCategory) {
      const category = categories.find((item) => item.id === nextCategory);
      if (category) url.searchParams.set("category", getCategorySlug(category, categories));
    } else url.searchParams.set("category", "all");
    if (nextQuery.trim()) url.searchParams.set("q", nextQuery.trim()); else url.searchParams.delete("q");
    if (nextPage > 1) url.searchParams.set("page", String(nextPage)); else url.searchParams.delete("page");
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  }

  function chooseCategory(categoryId: string) { setActiveCategory(categoryId); setPage(1); updateHomeUrl(1, categoryId, query); }
  function changeSearch(value: string) { setQuery(value); setPage(1); updateHomeUrl(1, activeCategory ?? defaultCategory?.id ?? "", value); }
  function changePage(nextPage: number) { setPage(nextPage); updateHomeUrl(nextPage, activeCategory ?? defaultCategory?.id ?? "", query, false); }

  const totalPages = Math.ceil((videosHook.totalCount ?? 0) / PUBLIC_PAGE_SIZE);
  useEffect(() => {
    if (!urlReady || videosHook.totalCount === null) return;
    const lastPage = Math.max(1, Math.ceil(videosHook.totalCount / PUBLIC_PAGE_SIZE));
    if (page > lastPage) changePage(lastPage);
  }, [urlReady, videosHook.totalCount, page]);

  return <main className="site-shell">
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={18}/></button>
      <Link className="home-link" href="/">Home</Link>
      <nav className={`topnav ${menuOpen ? "nav-open" : ""}`} aria-label="Categories"><button className="nav-link" onClick={() => { document.getElementById("categories")?.scrollIntoView({ behavior: "smooth" }); setMenuOpen(false); }}>Categories</button></nav>
      <div className="header-actions"><label className="search-box"><Search size={16}/><input value={query} onChange={(event) => changeSearch(event.target.value)} placeholder="Search videos" aria-label="Search videos"/><kbd><Command size={10}/> K</kbd></label><Link className="admin-trigger" href="/admin"><Settings2 size={15}/><span>Admin</span></Link></div>
    </header>
     <section className={`collection section-wrap ${activeCategory ? "category-results-page" : ""}`} id="top">
       {activeCategory === "" && <div className="section-header"><h1>Latest Videos</h1><span className="result-count">{videosHook.totalCount ?? 0} {(videosHook.totalCount ?? 0) === 1 ? "video" : "videos"}</span></div>}
       <div className="category-strip" id="categories"><div className="category-label">Categories</div><div className="category-chips"><button className={`category-chip ${activeCategory === "" ? "selected" : ""}`} onClick={() => chooseCategory("")}>All</button>{categories.map((category) => <CategoryPill key={category.id} category={category} selected={activeCategory === category.id} onClick={() => chooseCategory(category.id)}/>)}</div></div>
      {!urlReady || videosHook.loading && videosHook.videos.length === 0 ? <div className={`video-grid public-video-grid ${gridStyles.singleColumn} skeleton-grid`} role="status" aria-label="Loading videos">{Array.from({ length: 6 }, (_, index) => <article className="video-card skeleton-card" key={index}><div className="skeleton-thumbnail"/><div className="skeleton-title"><span/><span/></div></article>)}</div> : <div className={`video-grid public-video-grid ${gridStyles.singleColumn}`}>{videosHook.videos.map((video) => <article className="video-card" key={video.id}><Link className="thumbnail-button" href={`/watch/${video.id}`} aria-label={`Watch ${video.title}`}><img loading="lazy" src={video.thumbnail_url || "/film-placeholder.svg"} alt=""/><span className="thumb-shade"/><span className="play-disc"><Play size={17} fill="currentColor"/></span>{video.duration && <span className="duration"><Clock3 size={11}/>{video.duration}</span>}</Link><Link className="card-title" href={`/watch/${video.id}`}>{video.title}</Link><PublicViewCount count={video.display_views ?? 0} className="card-view-count"/>{video.description && <p className="card-description">{video.description}</p>}</article>)}</div>}
      {!videosHook.loading && videosHook.totalCount === 0 && <div className="empty-state"><Search size={22}/><strong>No videos found</strong><span>Try a different search or category.</span></div>}
      <VideoPagination page={page} totalPages={totalPages} loading={videosHook.loading} onPageChange={changePage}/>
    </section>
  </main>;
}

function CategoryPill({ category, selected, onClick }: { category: Category; selected: boolean; onClick: () => void }) { return <button className={`category-chip ${selected ? "selected" : ""}`} onClick={onClick}>{category.name}</button>; }
