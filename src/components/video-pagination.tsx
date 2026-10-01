"use client";

import styles from "@/components/video-pagination.module.css";

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

export default function VideoPagination({ page, totalPages, loading, onPageChange, hideNextOnLast = false }: { page: number; totalPages: number; loading: boolean; onPageChange: (page: number) => void; hideNextOnLast?: boolean }) {
  if (totalPages <= 1) return null;
  return <nav className={styles.container} aria-label="Video pages">
    {page > 1 && <button className={styles.button} type="button" onClick={() => onPageChange(page - 1)} disabled={loading}>← Previous</button>}
    <div className={styles.numbers}>{getPageItems(page, totalPages).map((item) => typeof item === "number"
      ? <button key={item} type="button" className={`${styles.button} ${item === page ? styles.numberActive : ""}`} aria-current={item === page ? "page" : undefined} onClick={() => onPageChange(item)} disabled={loading}>{item}</button>
      : <span key={item} className={styles.ellipsis} aria-hidden="true">…</span>)}</div>
    {(!hideNextOnLast || page < totalPages) && <button className={styles.button} type="button" onClick={() => onPageChange(page + 1)} disabled={loading}>Next →</button>}
  </nav>;
}
