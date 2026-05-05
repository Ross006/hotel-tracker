import { list } from "@vercel/blob";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { blobs } = await list({ prefix: "price-history.json" });
    if (blobs.length === 0) {
      return Response.json({ nights: {}, debug: "no blobs found" });
    }

    const res = await fetch(blobs[0].downloadUrl);
    if (!res.ok) {
      return Response.json({
        nights: {},
        debug: `fetch failed: ${res.status} ${res.statusText}`,
        url: blobs[0].url,
      });
    }
    const data = await res.json();

    // Migrate old single-night format to multi-night
    if (data.prices && !data.nights) {
      return Response.json({
        nights: {
          "2026-10-24": {
            prices: data.prices,
            lowest: data.lowest,
            lowestDate: data.lowestDate,
          },
        },
      });
    }

    return Response.json(data);
  } catch (error) {
    return Response.json(
      { nights: {}, debug: `error: ${error.message}` },
      { status: 500 }
    );
  }
}
