import { put, list } from "@vercel/blob";

// ─── CONFIG ───────────────────────────────────────────
const CONFIG = {
  hotelQuery: "The Caledonian Edinburgh",
  nights: [
    { checkIn: "2026-10-23", checkOut: "2026-10-24", label: "Oct 23" },
    { checkIn: "2026-10-24", checkOut: "2026-10-25", label: "Oct 24" },
    { checkIn: "2026-10-25", checkOut: "2026-10-26", label: "Oct 25" },
  ],
  adults: 2,
  currency: "USD",
  blobKey: "price-history.json",
};

// ─── HELPERS ──────────────────────────────────────────

async function fetchPriceForNight(checkIn, checkOut) {
  const params = new URLSearchParams({
    engine: "google_hotels",
    q: CONFIG.hotelQuery,
    check_in_date: checkIn,
    check_out_date: checkOut,
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

      let price;
      if (typeof priceStr === "number") {
        price = priceStr;
      } else if (typeof priceStr === "string" && priceStr.length > 0) {
        price = parseFloat(priceStr.replace(/[$$€,]/g, "").trim());
      }

      if ((!price || isNaN(price)) && rate.extracted_lowest) {
        price = rate.extracted_lowest;
      }

      if (price && !isNaN(price)) {
        return { price, hotelName: prop.name };
      }
    }
  }

  return { price: null, hotelName: null };
}

async function loadHistory() {
  try {
    const { blobs } = await list({ prefix: CONFIG.blobKey });
    if (blobs.length === 0) return { nights: {} };

    const res = await fetch(blobs[0].downloadUrl);
    const data = await res.json();

    // Migrate old single-night format to multi-night
    if (data.prices && !data.nights) {
      return {
        nights: {
          "2026-10-24": {
            prices: data.prices,
            lowest: data.lowest,
            lowestDate: data.lowestDate,
          },
        },
      };
    }

    return data;
  } catch {
    return { nights: {} };
  }
}

async function saveHistory(history) {
  await put(CONFIG.blobKey, JSON.stringify(history, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function sendSlack(message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return false;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });

  if (!res.ok) {
    console.warn(`Slack webhook error: ${res.status}`);
    return false;
  }
  return true;
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
    const results = await Promise.all(
      CONFIG.nights.map(async (night) => {
        const { price, hotelName } = await fetchPriceForNight(night.checkIn, night.checkOut);
        return { ...night, price, hotelName };
      })
    );

    const history = await loadHistory();
    const now = new Date().toISOString();
    let slackSent = false;
    const nightResults = [];
    const slackLines = [];

    for (const result of results) {
      const key = result.checkIn;

      if (!history.nights[key]) {
        history.nights[key] = { prices: [], lowest: null, lowestDate: null };
      }

      const nightHistory = history.nights[key];

      if (result.price) {
        nightHistory.prices.push({ price: result.price, date: now });

        const allPrices = nightHistory.prices.map((p) => p.price);
        const avgPrice = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
        const prevLowest = nightHistory.lowest;
        const isNewLowest = prevLowest === null || result.price < prevLowest;

        if (isNewLowest) {
          nightHistory.lowest = result.price;
          nightHistory.lowestDate = now;
          slackLines.push(
            `> *${result.label}*: $${result.price.toFixed(2)} ← new low! (was ${prevLowest !== null ? `$${prevLowest.toFixed(2)}` : "N/A"})`
          );
        }

        nightResults.push({
          night: result.label,
          checkIn: result.checkIn,
          price: result.price,
          average: Math.round(avgPrice * 100) / 100,
          lowest: nightHistory.lowest,
          isNewLowest,
          totalChecks: allPrices.length,
        });
      } else {
        nightResults.push({
          night: result.label,
          checkIn: result.checkIn,
          price: null,
          error: "Hotel not found in results",
        });
      }
    }

    await saveHistory(history);

    if (slackLines.length > 0) {
      const message = [
        `🏨 *New lowest price found — The Caledonian Edinburgh*`,
        ``,
        ...slackLines,
        ``,
        `🔗 <https://www.hilton.com/en/hotels/ednchqq-the-caledonian-edinburgh/|Book here>`,
      ].join("\n");

      slackSent = await sendSlack(message);
    }

    return Response.json({
      success: true,
      hotel: results.find((r) => r.hotelName)?.hotelName || CONFIG.hotelQuery,
      nights: nightResults,
      slackSent,
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
