export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "SERPAPI_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://serpapi.com/account.json?api_key=${apiKey}`,
      {
        cache: "no-store",
        next: { revalidate: 0 },
      }
    );
    if (!res.ok) {
      throw new Error(`SerpApi returned ${res.status}`);
    }

    const data = await res.json();
    return Response.json(
      {
        plan: data.plan_name || data.plan || "Unknown",
        searchesThisMonth: data.this_month_usage ?? data.searches_this_month ?? 0,
        totalLimit: data.total_searches_left != null
          ? data.total_searches_left + (data.this_month_usage ?? 0)
          : data.plan_searches_left ?? null,
        remaining: data.total_searches_left ?? data.plan_searches_left ?? null,
        fetchedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
