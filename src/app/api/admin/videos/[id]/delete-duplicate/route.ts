import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminMfaStatus, hasAdminTotpAal2 } from "@/lib/admin-mfa";
import { deleteManagedVideoObjectForRecord } from "@/lib/r2-storage";

export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Invalid video id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Admin authentication required" }, { status: 401 });
    const { data: membership, error: membershipError } = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (membershipError || !membership) return NextResponse.json({ error: "Admin authorization required" }, { status: 403 });
    const mfa = await getAdminMfaStatus(supabase);
    if (mfa.error || !hasAdminTotpAal2(mfa)) return NextResponse.json({ error: "Authenticator verification required" }, { status: 403 });

    const { data: video, error: videoError } = await supabase.from("videos").select("id,title,video_url,cloudflare_video_account_slot,cloudflare_video_bucket_name").eq("id", id).maybeSingle();
    if (videoError) throw videoError;
    if (!video) return NextResponse.json({ error: "Video record no longer exists" }, { status: 404 });

    const { data: references, error: referenceError } = await supabase.from("videos").select("id").eq("video_url", video.video_url).neq("id", id).limit(1);
    if (referenceError) throw referenceError;
    const sharedByAnotherVideo = Boolean(references?.length);

    const { error: deleteError } = await supabase.from("videos").delete().eq("id", id);
    if (deleteError) throw deleteError;

    let storageDeleted = false;
    let storageNote = "External source: its file is not controlled by this site.";
    if (sharedByAnotherVideo) {
      storageNote = "The source file is shared by another video record, so it was kept to preserve that video.";
    } else if (video.cloudflare_video_account_slot && video.cloudflare_video_bucket_name) {
      try {
        const result = await deleteManagedVideoObjectForRecord(video.cloudflare_video_account_slot, video.cloudflare_video_bucket_name, video.video_url);
        storageDeleted = result.deleted;
        storageNote = result.deleted
          ? "The duplicate’s managed R2 video object was deleted. Its thumbnail was preserved."
          : result.reason === "not-managed-r2-url" || result.reason === "outside-managed-upload-prefix"
            ? "The source is not in the managed video bucket; its file was not deleted."
            : "The source storage account is unavailable; its file was not deleted.";
      } catch {
        storageNote = "The video record was deleted, but the R2 object could not be deleted. Remove it from Cloudflare Storage if desired; its thumbnail was preserved.";
      }
    } else {
      storageNote = "No managed R2 account metadata is recorded for this legacy video; its source file was not deleted. Its thumbnail was preserved.";
    }

    return NextResponse.json({ deleted: true, storageDeleted, storageNote }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not delete the duplicate video record" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
