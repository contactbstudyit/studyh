"use client";

type PageItem = number | "ellipsis-start" | "ellipsis-end";

function getPageItems(current: number, total: number): PageItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const visible = new Set([1, total, current, current - 1, current + 1]);
  const pages = [...visible].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: PageItem[] = [];
  for (let index = 0; index < pages.length; index++) {
    if (index > 0 && pages[index] - pages[index - 1] > 1) result.push(pages[index] - pages[index - 1] === 2 ? pages[index] - 1 : index < pages.findIndex((page) => page === current) ? "ellipsis-start" : "ellipsis-end");
    result.push(pages[index]);
  }
  return result;
}

export default function VideoPagination({ page, totalPages, loading, onPageChange }: { page: number; totalPages: number; loading: boolean; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return <nav className="video-pagination" aria-label="Video pages">
    <button className="page-step" type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || loading}>← Previous</button>
    <div className="page-numbers">{getPageItems(page, totalPages).map((item) => typeof item === "number"
      ? <button key={item} type="button" className={item === page ? "page-number active" : "page-number"} aria-current={item === page ? "page" : undefined} onClick={() => onPageChange(item)} disabled={item === page || loading}>{item}</button>
      : <span key={item} className="page-ellipsis" aria-hidden="true">…</span>)}</div>
    <button className="page-step" type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || loading}>Next →</button>
  </nav>;
}
