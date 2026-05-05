import { put, list } from "@vercel/blob";

// ─── CONFIG ───────────────────────────────────────────
const CONFIG = {
  hotelQuery: "The Caledonian Edinburgh",
  checkIn: "2026-10-24",
  checkOut: "2026-10-25",
  adults: 2,
  currency: "USD",
  blobKey: "price-history.json",
};

// ─── HELPERS ──────────────────────────────────────────

async function fetchPrice() {
  const params = new URLSearchParams({
    engine: "google_hotels",
    q: CONFIG.hotelQuery,
    check_in_date: CONFIG.checkIn,
    check_out_date: CONFIG.checkOut,
    adults: String(CONFIG.adults),
    currency: CONFIG.currency,
    gl: "uk",
    hl: "en",
    api_key: process.env.SERPAPI_API_KEY,
  });

  const res = await fetch(
    `https://serpapi.com/search.json?${params.toString()}`
  );
  if (!res.ok) {
    throw new Error(`SerpApi error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const properties = data.properties || [];

  for (const prop of properties) {
    const name = (prop.name || "").toLowerCase();
    if (name.includes("caledonian") && name.includes("edinburgh")) {
      const rate = prop.rate_per_night || {};
      const priceStr =
        rate.lowest || rate.before_taxes_fees || rate.extracted_lowest || "";

      // Handle both string ("$178") and number formats
      let price;
      if (typeof priceStr === "number") {
        price = priceStr;
      } else if (typeof priceStr === "string" && priceStr.length > 0) {
        price = parseFloat(
          priceStr.replace(/[$$€,]/g, "").trim()
        );
      }

      // Also check extracted_lowest (numeric field SerpApi sometimes provides)
      if ((!price || isNaN(price)) && rate.extracted_lowest) {
        price = rate.extracted_lowest;
      }

      if (price && !isNaN(price)) {
        return { price, hotelName: prop.name, raw: data };
      }
    }
  }

  return { price: null, hotelName: null, raw: data };
}

async function loadHistory() {
  try {
    // List blobs to find our history file
    const { blobs } = await list({ prefix: CONFIG.blobKey });
    if (blobs.length === 0) {
      return { prices: [], lowest: null, lowestDate: null };
    }

    const res = await fetch(blobs[0].url);
    return await res.json();
  } catch {
    return { prices: [], lowest: null, lowestDate: null };
  }
}

async function saveHistory(history) {
  await put(CONFIG.blobKey, JSON.stringify(history, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

async function sendSlack(message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("SLACK_WEBHOOK_URL not set");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook error: ${res.status}`);
  }
}

// ─── ROUTE HANDLER ────────────────────────────────────

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const userAgent = request.headers.get("user-agent") || "";
  const isVercelCron = userAgent.includes("vercel-cron");
  const referer = request.headers.get("referer") || "";
  const host = request.headers.get("host") || "";
  const isSameOrigin = referer.includes(host);

  if (!isVercelCron && !isSameOrigin && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { price, hotelName, raw } = await fetchPrice();

    if (!price) {
      // Log what we got back for debugging
      const propertyNames = (raw.properties || [])
        .slice(0, 5)
        .map((p) => p.name)
        .join(", ");

      return Response.json({
        success: false,
        message: "Hotel not found in results",
        propertiesReturned: propertyNames,
        timestamp: new Date().toISOString(),
      });
    }

    const history = await loadHistory();
    const now = new Date().toISOString();

    // Record this price
    history.prices.push({ price, date: now });

    // Compute stats
    const allPrices = history.prices.map((p) => p.price);
    const avgPrice = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    const prevLowest = history.lowest;
    const isNewLowest = prevLowest === null || price < prevLowest;

    if (isNewLowest) {
      history.lowest = price;
      history.lowestDate = now;
    }

    await saveHistory(history);

    // Send Slack message if new lowest
    if (isNewLowest) {
      const message = [
        `🏨 *New lowest price: The Caledonian Edinburgh — $${price.toFixed(2)}/night*`,
        ``,
        `> Current price:  $${price.toFixed(2)}`,
        `> Previous lowest: ${prevLowest !== null ? `$${prevLowest.toFixed(2)}` : "N/A (first check)"}`,
        `> Average price:  $${avgPrice.toFixed(2)} (over ${allPrices.length} checks)`,
        ``,
        `📅 ${CONFIG.checkIn} → ${CONFIG.checkOut}`,
        `🔗 <https://www.hilton.com/en/hotels/ednchqq-the-caledonian-edinburgh/|Book here>`,
      ].join("\n");

      await sendSlack(message);
    }

    return Response.json({
      success: true,
      hotel: hotelName,
      currentPrice: price,
      averagePrice: Math.round(avgPrice * 100) / 100,
      lowestEver: history.lowest,
      isNewLowest,
      totalChecks: allPrices.length,
      slackSent: isNewLowest,
      timestamp: now,
    });
  } catch (error) {
    console.error("Price check failed:", error);
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
