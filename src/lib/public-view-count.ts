export function formatPublicViewCount(count: number) {
  if (count < 1_000) return String(Math.max(0, Math.trunc(count)));
  const units = [[1_000_000_000_000, "T"], [1_000_000_000, "B"], [1_000_000, "M"], [1_000, "K"]] as const;
  let index = units.findIndex(([limit]) => count >= limit);
  if (index < 0) return String(Math.max(0, Math.trunc(count)));
  let scaled = count / units[index][0];
  if (scaled >= 999.95 && index > 0) { index--; scaled = count / units[index][0]; }
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}${units[index][1]}`;
}
