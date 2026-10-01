import { formatPublicViewCount } from "@/lib/public-view-count";

export default function PublicViewCount({ count, className = "" }: { count: number; className?: string }) {
  return <span className={`public-view-count ${className}`}>{formatPublicViewCount(count)} views</span>;
}
