import WatchPage from "@/components/watch-page";
import { notFound } from "next/navigation";
import { getPublicVideoById } from "@/lib/category-routes";
import { detectSourceType, getSourceHost } from "@/lib/video-playback";
import { getPublicDisplayViews } from "@/lib/public-view-count-server";

export const dynamic = "force-dynamic";

const VIDEO_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WatchRoute({ params }: PageProps) {
  const { id } = await params;

  if (!VIDEO_ID_PATTERN.test(id)) {
    notFound();
  }

  const video = await getPublicVideoById(id);

  if (!video) {
    notFound();
  }

  const {
    video_url: sourceUrl,
    views: _realViews,
    display_view_count: _displayBase,
    published_at: _publishedAt,
    ...publicVideo
  } = video;

  return (
    <WatchPage
      video={publicVideo}
      playbackUrl=""
      playbackType={detectSourceType(sourceUrl)}
      sourceHost={getSourceHost(sourceUrl)}
      displayViews={getPublicDisplayViews(video)}
    />
  );
}
