import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CategoryVideos from "@/components/category-videos";
import { getPublicCategoryBySlug } from "@/lib/category-routes";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

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

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const category = await getPublicCategoryBySlug(slug);
  if (!category) notFound();
  return <CategoryVideos category={category} />;
}
