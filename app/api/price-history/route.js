import { list } from "@vercel/blob";
import { loadTripConfig } from "../../../lib/trip-config-store";

export const dynamic = "force-dynamic";

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

export async function GET() {
  try {
    const config = await loadTripConfig();
    const { blobs } = await list({ prefix: "price-history.json" });
    console.log(
      "[price-history] blobs:",
      JSON.stringify(
        blobs.map((b) => ({
          pathname: b.pathname,
          size: b.size,
        }))
      )
    );

    if (blobs.length === 0) {
      return Response.json({
        config,
        hotelNights: {},
        hotelStay: { prices: [], lowest: null, lowestDate: null },
        flight: { prices: [], lowest: null, lowestDate: null },
        combined: { prices: [], lowest: null, lowestDate: null },
        debug: "no blobs found",
      });
    }

    const exact = blobs.find((b) => b.pathname === "price-history.json");
    const blob =
      exact ||
      [...blobs].sort(
        (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
      )[0];
    const fetchUrl = blob.url;
    console.log("[price-history] fetching:", fetchUrl);

    const res = await fetch(fetchUrl, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    console.log("[price-history] fetch status:", res.status);

    if (!res.ok) {
      const text = await res.text();
      return Response.json({
        config,
        hotelNights: {},
        hotelStay: { prices: [], lowest: null, lowestDate: null },
        flight: { prices: [], lowest: null, lowestDate: null },
        combined: { prices: [], lowest: null, lowestDate: null },
        debug: `fetch ${res.status}: ${text.slice(0, 200)}`,
        blobInfo: { url: blob.url, downloadUrl: blob.downloadUrl, pathname: blob.pathname },
      });
    }

    const data = await res.json();

    if (data.prices && !data.nights && !data.hotelNights) {
      return Response.json({
        config,
        hotelNights: {
          "2026-10-24": {
            prices: data.prices,
            lowest: data.lowest,
            lowestDate: data.lowestDate,
          },
        },
        hotelStay: { prices: [], lowest: null, lowestDate: null },
        flight: { prices: [], lowest: null, lowestDate: null },
        combined: { prices: [], lowest: null, lowestDate: null },
      });
    }

    if (data.nights && !data.hotelNights) data.hotelNights = data.nights;
    if (data.totalStay && !data.hotelStay) data.hotelStay = data.totalStay;
    if (!data.hotelNights) data.hotelNights = {};
    if (!data.hotelStay) data.hotelStay = { prices: [], lowest: null, lowestDate: null };
    if (!data.flight) data.flight = { prices: [], lowest: null, lowestDate: null };
    if (!data.combined) data.combined = { prices: [], lowest: null, lowestDate: null };

    return Response.json({ ...data, config });
  } catch (error) {
    console.error("Price history error:", errorMessage(error));
    return Response.json(
      {
        config: null,
        hotelNights: {},
        hotelStay: { prices: [], lowest: null, lowestDate: null },
        flight: { prices: [], lowest: null, lowestDate: null },
        combined: { prices: [], lowest: null, lowestDate: null },
        debug: `error: ${errorMessage(error)}`,
      },
      { status: 500 }
    );
  }
}
