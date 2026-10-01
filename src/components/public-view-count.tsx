import { Info } from "lucide-react";
import { formatPublicViewCount } from "@/lib/public-view-count";

export default function PublicViewCount({ count, className = "" }: { count: number; className?: string }) {
  return <span className={`public-view-count ${className}`} title="Displayed count includes a promotional starting component; real views are tracked separately."><span>{formatPublicViewCount(count)} views</span><Info size={12} aria-label="Includes promotional starting count"/></span>;
}
