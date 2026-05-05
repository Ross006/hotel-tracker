import { list } from "@vercel/blob";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { blobs } = await list({ prefix: "price-history.json" });
    if (blobs.length === 0) {
      return Response.json({ prices: [], lowest: null, lowestDate: null });
    }
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    const data = await res.json();
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { prices: [], lowest: null, lowestDate: null, error: error.message },
      { status: 500 }
    );
  }
}
