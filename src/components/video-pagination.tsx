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
  return <nav className="pagination" aria-label="Video pages" style={{ gap: 8, flexWrap: "wrap" }}>
    <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || loading} style={{ minHeight: 34, padding: "8px 11px" }}>← Previous</button>
    <div className="page-numbers" style={{ display: "flex", alignItems: "center", gap: 4 }}>{getPageItems(page, totalPages).map((item) => typeof item === "number"
      ? <button key={item} type="button" className={item === page ? "page-number category-chip selected" : "page-number category-chip"} aria-current={item === page ? "page" : undefined} onClick={() => onPageChange(item)} disabled={loading} style={{ minWidth: 34, height: 34, padding: "0 8px" }}>{item}</button>
      : <span key={item} aria-hidden="true" style={{ padding: "0 3px", color: "#777", fontSize: 11 }}>…</span>)}</div>
    <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || loading} style={{ minHeight: 34, padding: "8px 11px" }}>Next →</button>
  </nav>;
}
