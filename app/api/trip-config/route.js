import { loadTripConfig, saveTripConfig } from "../../../lib/trip-config-store";
import { normalizeTripConfig } from "../../../lib/trip-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await loadTripConfig();
    return Response.json(config, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const config = normalizeTripConfig(body);
    await saveTripConfig(config);
    return Response.json({ success: true, config });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
