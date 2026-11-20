import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { videoId?: unknown; watched?: unknown };
    if (typeof body.videoId !== "string" || !UUID_PATTERN.test(body.videoId)) return NextResponse.json({ error: "Invalid reel video" }, { status: 400 });
    const supabase = await createClient();
    const auth = await supabase.auth.getUser();
    const visitorId = auth.data.user?.id ?? request.headers.get("x-reel-visitor-id");
    if (!visitorId || !UUID_PATTERN.test(visitorId)) return NextResponse.json({ error: "Invalid reel visitor" }, { status: 400 });
    const { data, error } = await supabase.rpc("record_reel_impression", { p_visitor_id: visitorId, p_video_id: body.videoId, p_watched: body.watched === true });
    if (error) throw error;
    return NextResponse.json({ recorded: data === true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not record reel impression" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
