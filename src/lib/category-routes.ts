import { createClient } from "@/lib/supabase/server";
import { getCategorySlug } from "@/lib/category-slug";
import type { VideoRecord } from "@/hooks/use-library";

export type PublicCategory = { id: string; name: string; description: string; image_url: string | null; created_at: string; updated_at: string };

export async function getPublicCategoriesForRoutes(): Promise<PublicCategory[]> {
  const supabase = await createClient();
  const categories: PublicCategory[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("categories").select("id,name,description,image_url,created_at,updated_at").order("name", { ascending: true }).range(offset, offset + 499);
    if (error) throw error;
    const page = (data ?? []) as PublicCategory[];
    categories.push(...page);
    if (page.length < 500) return categories;
  }
}

export async function getPublicCategoryBySlug(slug: string) {
  const categories = await getPublicCategoriesForRoutes();
  return categories.find((category) => getCategorySlug(category, categories) === slug) ?? null;
}

export async function getPublicVideoById(id: string): Promise<VideoRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("videos").select("*, categories(name)").eq("id", id).eq("published", true).maybeSingle();
  if (error) throw error;
  return data as VideoRecord | null;
}
