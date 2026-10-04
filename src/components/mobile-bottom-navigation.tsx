"use client";

import { Clapperboard, Filter, House, Search } from "lucide-react";
import Link from "next/link";

type Props = {
  slug: string;
  context: "category" | "reels";
  filterActive?: boolean;
  onSearch?: () => void;
  onFilter?: () => void;
};

export default function MobileBottomNavigation({ slug, context, filterActive = false, onSearch, onFilter }: Props) {
  const categoryHref = `/category/${encodeURIComponent(slug)}`;

  return <nav className="reels-mobile-nav" aria-label="Mobile navigation">
    <Link className="reels-mobile-control" href={categoryHref} aria-label="Home"><House size={18}/><span>Home</span></Link>
    <Link className={`reels-mobile-control ${context === "reels" ? "active" : ""}`} href={`${categoryHref}/reels`} aria-current={context === "reels" ? "page" : undefined} aria-label="Reels"><Clapperboard size={18}/><span>Reels</span></Link>
    {context === "category" && onSearch
      ? <button className="reels-mobile-control" type="button" onClick={onSearch} aria-label="Search"><Search size={18}/><span>Search</span></button>
      : <Link className="reels-mobile-control" href={`${categoryHref}?focusSearch=1`} aria-label="Search"><Search size={18}/><span>Search</span></Link>}
    {context === "category" && onFilter
      ? <button className={`reels-mobile-control ${filterActive ? "active" : ""}`} type="button" onClick={onFilter} aria-label="Filter" aria-pressed={filterActive}><Filter size={18}/><span>Filter</span></button>
      : <Link className="reels-mobile-control" href={`${categoryHref}?openFilter=1`} aria-label="Filter"><Filter size={18}/><span>Filter</span></Link>}
  </nav>;
}
