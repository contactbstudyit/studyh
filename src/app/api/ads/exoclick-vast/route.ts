const EXOCLICK_VAST_URL = "https://s.magsrv.com/v1/vast.php?idzone=6047418";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "development") {
    console.info("[exoclick-vast-server-diagnostic] ad tag configuration requested", { zone: "6047418" });
  }
  return Response.json({ adTagUrl: EXOCLICK_VAST_URL }, { headers: { "cache-control": "no-store" } });
}
