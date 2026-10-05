const EXOCLICK_VAST_URL = "https://s.magsrv.com/v1/vast.php?idzone=6047418";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(null, {
    status: 307,
    headers: {
      location: EXOCLICK_VAST_URL,
      "cache-control": "no-store",
    },
  });
}
