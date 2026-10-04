import { notFound } from "next/navigation";
import CategoryReels from "@/components/category-reels";
import { getPublicCategoryBySlug } from "@/lib/category-routes";

export const dynamic = "force-dynamic";

export default async function CategoryReelsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getPublicCategoryBySlug(slug);
  if (!category) notFound();

  return <CategoryReels key={slug} slug={slug} categoryName={category.name}/>;
}
