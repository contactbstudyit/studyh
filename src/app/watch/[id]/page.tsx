import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WatchPage from "@/components/watch-page";
import { getPublicVideoById } from "@/lib/category-routes";
import { createVideoPlaybackUrl } from "@/lib/media-playback-server";
import { detectSourceType, getSourceHost } from "@/lib/video-playback";

export const dynamic = "force-dynamic";
const VIDEO_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!VIDEO_ID_PATTERN.test(id)) return { title: "Video not found" };
  const video = await getPublicVideoById(id);
  if (!video) return { title: "Video not found" };
  return { title: video.title, description: video.description || `${video.title} video` };
}

export default async function WatchRoute({ params }: PageProps) {
  const { id } = await params;
  if (!VIDEO_ID_PATTERN.test(id)) notFound();
  const video = await getPublicVideoById(id);
  if (!video) notFound();
  const { video_url: sourceUrl, ...publicVideo } = video;
  return <WatchPage video={publicVideo} playbackUrl={createVideoPlaybackUrl(video.id)} playbackType={detectSourceType(sourceUrl)} sourceHost={getSourceHost(sourceUrl)} />;
}
