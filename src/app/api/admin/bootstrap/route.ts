import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== request.headers.get("host")) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const { setupToken } = await request.json() as { setupToken?: unknown };
    const expected = process.env.ADMIN_SETUP_TOKEN;
    if (typeof setupToken !== "string" || setupToken.length < 24 || setupToken.length > 256 || !expected) {
      return NextResponse.json({ error: "First-admin setup is not configured." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const actualBytes = Buffer.from(setupToken);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
      return NextResponse.json({ error: "Invalid first-admin setup token." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Sign in before first-admin setup." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { data, error } = await supabase.rpc("bootstrap_first_admin", { p_setup_token: setupToken });
    if (error) return NextResponse.json({ error: "First-admin setup is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
    if (!data) return NextResponse.json({ error: "This account is not eligible for first-admin setup." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to complete first-admin setup." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
