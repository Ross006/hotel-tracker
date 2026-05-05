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
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { nights: {}, debug: `error: ${error.message}` },
      { status: 500 }
    );
  }
}
