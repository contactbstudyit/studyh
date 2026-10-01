type SluggableCategory = { id: string; name: string };

export function slugifyCategory(name: string) {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "category";
}

export function getCategorySlug(category: SluggableCategory, categories: SluggableCategory[]) {
  const base = slugifyCategory(category.name);
  const collisions = categories.filter((item) => slugifyCategory(item.name) === base);
  if (collisions.length < 2) return base;
  const shortIds = collisions.map((item) => item.id.replace(/-/g, "").slice(0, 8).toLowerCase());
  if (new Set(shortIds).size === collisions.length) return `${base}-${category.id.replace(/-/g, "").slice(0, 8).toLowerCase()}`;
  return `${base}-${category.id.toLowerCase()}`;
}
