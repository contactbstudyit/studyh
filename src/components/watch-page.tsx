"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Clock3, Command, Film, Play, Search, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRecommendedVideos, recordPublicVideoView } from "@/hooks/use-library";
import type { VideoRecord } from "@/hooks/use-library";
import { VideoPlayer } from "@/components/video-player";

export default function WatchPage({ video }: { video: VideoRecord }) {
  const [search, setSearch] = useState("");
  const [viewCount, setViewCount] = useState(video.views);
  const recommended = useRecommendedVideos(video);

  useEffect(() => {
    setViewCount(video.views);
    void recordPublicVideoView(video.id).then((counted) => { if (counted) setViewCount((current) => current + 1); });
  }, [video.id, video.views]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = new URL("/", window.location.origin);
    url.searchParams.set("category", "all");
    if (search.trim()) url.searchParams.set("q", search.trim());
    window.location.assign(url.toString());
  }

  const categoryName = video.categories?.name ?? "";

  return <main className="site-shell watch-page-shell">
    <header className="topbar watch-page-topbar">
      <Link className="home-link" href="/"><ArrowLeft size={14}/> Home</Link>
      <nav className="topnav" aria-label="Categories"><Link className="nav-link" href="/#categories">Categories</Link></nav>
      <div className="header-actions"><form className="watch-search-form" onSubmit={submitSearch}><label className="search-box"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search videos" aria-label="Search videos"/><kbd><Command size={10}/> K</kbd></label></form><Link className="admin-trigger" href="/admin"><Settings2 size={15}/><span>Admin</span></Link></div>
    </header>

    <div className="watch-page-content">
      <section className="watch-page-current" aria-label="Now playing">
        <VideoPlayer video={video}/>
        <div className="watch-page-details">
          <div className="watch-page-title"><h1>{video.title}</h1><span>{viewCount.toLocaleString()} views</span></div>
          {categoryName && <span className="watch-page-category">{categoryName}</span>}
          {video.description && <p>{video.description}</p>}
        </div>
      </section>

      <section className="recommended-section" aria-labelledby="recommended-heading">
        <div className="recommended-heading"><div><h2 id="recommended-heading">Recommended</h2><span>More to watch</span></div></div>
        {recommended.loading && recommended.videos.length === 0 && <div className="video-grid skeleton-grid" role="status" aria-label="Loading recommended videos">{Array.from({ length: 5 }, (_, index) => <article className="video-card skeleton-card" key={index}><div className="skeleton-thumbnail"/><div className="skeleton-title"><span/><span/></div></article>)}</div>}
        {recommended.videos.length > 0 && <div className="video-grid">{recommended.videos.map((item) => <article className="video-card" key={item.id}><Link className="thumbnail-button" href={`/watch/${item.id}`} aria-label={`Watch ${item.title}`}><img loading="lazy" src={item.thumbnail_url || "/film-placeholder.svg"} alt=""/><span className="thumb-shade"/><span className="play-disc"><Play size={17} fill="currentColor"/></span>{item.duration && <span className="duration"><Clock3 size={11}/>{item.duration}</span>}</Link><Link className="card-title" href={`/watch/${item.id}`}>{item.title}</Link>{item.description && <p className="card-description">{item.description}</p>}</article>)}</div>}
        {!recommended.loading && recommended.videos.length === 0 && <div className="recommended-empty"><Film size={18}/><span>No recommended videos yet.</span></div>}
        {recommended.hasMore && <div className="recommended-more"><button className="button-secondary" onClick={recommended.loadMore} disabled={recommended.loadingMore}>{recommended.loadingMore ? "Loading..." : "Load More"}<ArrowRight size={14}/></button></div>}
      </section>
    </div>
  </main>;
}
