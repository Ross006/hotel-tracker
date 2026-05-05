import { list } from "@vercel/blob";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { blobs } = await list({ prefix: "price-history.json" });
    console.log("Blob list result:", JSON.stringify(blobs.map(b => ({
      url: b.url,
      pathname: b.pathname,
      downloadUrl: b.downloadUrl,
      size: b.size,
    }))));

    if (blobs.length === 0) {
      return Response.json({ nights: {}, debug: "no blobs found" });
    }

    const blob = blobs[0];
    const fetchUrl = blob.url;
    console.log("Fetching from:", fetchUrl);

    const res = await fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    console.log("Fetch status:", res.status);

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
