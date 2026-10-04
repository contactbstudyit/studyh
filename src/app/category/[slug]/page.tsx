import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CategoryVideos from "@/components/category-videos";
import { getPublicCategoryBySlug } from "@/lib/category-routes";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string | string[]; page?: string | string[]; q?: string | string[]; openFilter?: string | string[]; focusSearch?: string | string[] }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await getPublicCategoryBySlug(slug);
  if (!category) return { title: "Category not found" };
  return {
    title: `${category.name} videos`,
    description: category.description || `Browse ${category.name} videos.`,
    alternates: { canonical: `/category/${slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const category = await getPublicCategoryBySlug(slug);
  if (!category) notFound();
  const sort = Array.isArray(search.sort) ? search.sort[0] : search.sort;
  const pageValue = Number.parseInt(Array.isArray(search.page) ? search.page[0] : search.page ?? "1", 10);
  const query = Array.isArray(search.q) ? search.q[0] : search.q ?? "";
  const openFilter = Array.isArray(search.openFilter) ? search.openFilter[0] : search.openFilter;
  const focusSearch = Array.isArray(search.focusSearch) ? search.focusSearch[0] : search.focusSearch;
  return <CategoryVideos category={category} slug={slug} initialSort={sort} initialPage={Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1} initialQuery={query} initialFilterOpen={openFilter === "1"} focusSearchOnMount={focusSearch === "1"} />;
}
