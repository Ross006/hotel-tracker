import { list } from "@vercel/blob";

export const dynamic = "force-dynamic";

const BLOB_KEY = "price-history.json";

export async function GET() {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY });
    console.log(
      `[price-history] ${blobs.length} blob(s) match prefix: ` +
        JSON.stringify(
          blobs.map((b) => ({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt }))
        )
    );

    if (blobs.length === 0) {
      return Response.json({ nights: {}, debug: "no blobs found" });
    }

    const exact = blobs.filter((b) => b.pathname === BLOB_KEY);
    const pool = exact.length > 0 ? exact : blobs;
    const blob = [...pool].sort(
      (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
    )[0];
    console.log(
      `[price-history] selected ${blob.pathname} (uploadedAt=${blob.uploadedAt}, size=${blob.size})`
    );

    const res = await fetch(blob.url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    console.log("[price-history] fetch status:", res.status);

    if (!res.ok) {
      const text = await res.text();
      return Response.json({
        nights: {},
        debug: `fetch ${res.status}: ${text.slice(0, 200)}`,
        blobInfo: { url: blob.url, downloadUrl: blob.downloadUrl, pathname: blob.pathname },
      });
    }

    const data = await res.json();

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
    console.error("Price history error:", error);
    return Response.json(
      { nights: {}, debug: `error: ${error.message}` },
      { status: 500 }
    );
  }
}
