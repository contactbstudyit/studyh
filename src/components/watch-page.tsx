"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Command, Film, Play, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRecommendedVideos } from "@/hooks/use-library";
import type { VideoRecord } from "@/hooks/use-library";
import { VideoPlayer } from "@/components/video-player";
import { ExoclickVastAd } from "@/components/exoclick-vast-ad";
import styles from "@/components/watch-page.module.css";
import type { VideoSourceType } from "@/lib/video-playback";
import { formatPublicViewCount } from "@/lib/public-view-count";
import PublicViewCount from "@/components/public-view-count";

type WatchVideo = Omit<VideoRecord, "video_url" | "views" | "display_view_count" | "published_at">;

export default function WatchPage({ video, playbackUrl, playbackType, sourceHost, displayViews }: { video: WatchVideo; playbackUrl: string; playbackType: VideoSourceType; sourceHost: string; displayViews: number }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [viewCount, setViewCount] = useState(displayViews);
  const [mobileLayout, setMobileLayout] = useState(false);
  const contentVideoRef = useRef<HTMLVideoElement | null>(null);
  const recommended = useRecommendedVideos(video);
  const setContentVideo = useCallback((element: HTMLVideoElement | null) => { contentVideoRef.current = element; }, []);

  useEffect(() => {
    const breakpoint = window.matchMedia("(max-width: 720px)");
    const update = () => setMobileLayout(breakpoint.matches);
    update();
    breakpoint.addEventListener("change", update);
    return () => breakpoint.removeEventListener("change", update);
  }, []);

  useEffect(() => { setViewCount(displayViews); }, [video.id, displayViews]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = new URL("/", window.location.origin);
    url.searchParams.set("category", "all");
    if (search.trim()) url.searchParams.set("q", search.trim());
    window.location.assign(url.toString());
  }

  return <main className="site-shell watch-page-shell">
    <header className="topbar watch-page-topbar">
      <button className="icon-button watch-back-button" type="button" aria-label="Go back" onClick={() => { if (window.history.length > 1) router.back(); else router.push("/"); }}><ArrowLeft size={17}/></button>
      <div className="header-actions"><form className="watch-search-form" onSubmit={submitSearch}><label className="search-box"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search videos" aria-label="Search videos"/><kbd><Command size={10}/> K</kbd></label></form></div>
    </header>

    <div className="watch-page-content">
      <section className="watch-page-current" aria-label="Now playing">
        <VideoPlayer video={video} playbackUrl={playbackUrl} playbackType={playbackType} sourceHost={sourceHost} autoPlay={false} onVideoElement={setContentVideo} playerOverlay={<ExoclickVastAd contentVideoRef={contentVideoRef} videoId={video.id}/>} onViewCounted={() => setViewCount((current) => current + 1)}/>
        <div className="watch-page-details">
          <div className="watch-page-title"><h1>{video.title}</h1><span className="public-view-count">{formatPublicViewCount(viewCount)} views</span></div>
          {video.description && <p>{video.description}</p>}
        </div>
      </section>

      <section className="recommended-section" aria-labelledby="recommended-heading">
        <div className="recommended-heading"><div><h2 id="recommended-heading">Recommended</h2><span>More to watch</span></div></div>
        {recommended.loading && recommended.videos.length === 0 && <div className={`video-grid skeleton-grid ${styles.recommendedGrid}`} style={mobileLayout ? { gridTemplateColumns: "minmax(0,1fr)" } : undefined} role="status" aria-label="Loading recommended videos">{Array.from({ length: 5 }, (_, index) => <article className="video-card skeleton-card" key={index}><div className="skeleton-thumbnail"/><div className="skeleton-title"><span/><span/></div></article>)}</div>}
        {recommended.videos.length > 0 && <div className={`video-grid ${styles.recommendedGrid}`} style={mobileLayout ? { gridTemplateColumns: "minmax(0,1fr)" } : undefined}>{recommended.videos.map((item) => <article className="video-card" key={item.id}><Link className="thumbnail-button" href={`/watch/${item.id}`} aria-label={`Watch ${item.title}`}><img loading="lazy" src={item.thumbnail_url || "/film-placeholder.svg"} alt=""/><span className="thumb-shade"/><span className="play-disc"><Play size={17} fill="currentColor"/></span></Link><Link className="card-title" href={`/watch/${item.id}`}>{item.title}</Link><PublicViewCount count={item.display_views ?? 0} className="card-view-count"/>{item.duration && <span className="watch-card-duration">{item.duration}</span>}{item.description && <p className="card-description">{item.description}</p>}</article>)}</div>}
        {!recommended.loading && recommended.videos.length === 0 && <div className="recommended-empty"><Film size={18}/><span>No recommended videos yet.</span></div>}
        {recommended.hasMore && <div className="recommended-more"><button className="button-secondary" onClick={recommended.loadMore} disabled={recommended.loadingMore}>{recommended.loadingMore ? "Loading..." : "Load More"}<ArrowRight size={14}/></button></div>}
      </section>
    </div>
  </main>;
}
