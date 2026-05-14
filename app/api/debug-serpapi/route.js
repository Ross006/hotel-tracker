export const dynamic = "force-dynamic";

const DEFAULT_NIGHTS = [
  { checkIn: "2026-10-23", checkOut: "2026-10-24", label: "Oct 23" },
  { checkIn: "2026-10-24", checkOut: "2026-10-25", label: "Oct 24" },
  { checkIn: "2026-10-25", checkOut: "2026-10-26", label: "Oct 25" },
];

export async function GET(request) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "SERPAPI_API_KEY not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const checkIn = url.searchParams.get("checkIn") || DEFAULT_NIGHTS[0].checkIn;
  const checkOut = url.searchParams.get("checkOut") || DEFAULT_NIGHTS[0].checkOut;
  const q = url.searchParams.get("q") || "The Caledonian Edinburgh";
  const raw = url.searchParams.get("raw") === "1";

  const params = new URLSearchParams({
    engine: "google_hotels",
    q,
    check_in_date: checkIn,
    check_out_date: checkOut,
    adults: "2",
    currency: "USD",
    gl: "uk",
    hl: "en",
    api_key: apiKey,
  });

  const requestUrl = `https://serpapi.com/search.json?${params.toString()}`;
  console.log("[debug-serpapi] query:", q, checkIn, "->", checkOut);

  let data;
  try {
    const res = await fetch(requestUrl);
    if (!res.ok) {
      const text = await res.text();
      console.log("[debug-serpapi] http error:", res.status, text.slice(0, 300));
      return Response.json(
        { error: `SerpApi ${res.status}`, body: text.slice(0, 1000) },
        { status: 502 }
      );
    }
    data = await res.json();
  } catch (err) {
    console.log("[debug-serpapi] fetch threw:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }

  if (raw) return Response.json(data);

  const topLevelKeys = Object.keys(data);
  const properties = data.properties || [];
  const propertySummaries = properties.map((p) => ({
    name: p.name,
    type: p.type,
    rate_per_night: p.rate_per_night,
    total_rate: p.total_rate,
    extracted_hotel_class: p.extracted_hotel_class,
  }));

  const caledonianMatches = properties.filter((p) => {
    const n = (p.name || "").toLowerCase();
    return n.includes("caledonian") || n.includes("princes street");
  }).map((p) => ({ name: p.name, rate_per_night: p.rate_per_night }));

  const summary = {
    query: { q, checkIn, checkOut },
    topLevelKeys,
    propertyCount: properties.length,
    serpApiError: data.error || null,
    searchMetadataStatus: data.search_metadata?.status || null,
    properties: propertySummaries,
    caledonianOrPrincesStreetMatches: caledonianMatches,
  };

  console.log("[debug-serpapi] summary:", JSON.stringify(summary));
  return Response.json(summary);
}
