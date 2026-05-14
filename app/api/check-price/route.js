import { put, list } from "@vercel/blob";
import { Resend } from "resend";

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

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function parseNumberEnv(value) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeBookingSignal(current, lowest) {
  if (current == null || lowest == null || lowest <= 0) {
    return {
      action: "insufficient_data",
      label: "Need more data",
      deltaPct: null,
      reason: "Not enough history to estimate a booking signal yet.",
    };
  }

  const deltaPct = ((current - lowest) / lowest) * 100;
  if (deltaPct <= 2) {
    return {
      action: "book_now",
      label: "Book now",
      deltaPct: Math.round(deltaPct * 100) / 100,
      reason: "Current total is within 2% of the best seen price.",
    };
  }
  if (deltaPct <= 5) {
    return {
      action: "consider",
      label: "Consider booking",
      deltaPct: Math.round(deltaPct * 100) / 100,
      reason: "Current total is close to the best seen price.",
    };
  }
  return {
    action: "wait",
    label: "Wait",
    deltaPct: Math.round(deltaPct * 100) / 100,
    reason: "Current total is still meaningfully above the best seen price.",
  };
}

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

  console.log(
    `[check-price] ${checkIn} -> ${checkOut}: shape=${
      data.rate_per_night && data.name ? "single-hotel" : "list"
    } properties=${properties.length} serpApiError=${data.error || "none"}`
  );

  // SerpApi returns a single-hotel detail response (top-level name + rate_per_night)
  // when the query resolves to one specific property. Otherwise it returns a list
  // under data.properties.
  if (data.rate_per_night && data.name) {
    const price = parseRate(data.rate_per_night);
    console.log(
      `[check-price] single-hotel "${data.name}" for ${checkIn}, rate=${JSON.stringify(data.rate_per_night)}, parsedPrice=${price}`
    );
    if (price) return { price, hotelName: data.name };
  }

  for (const prop of properties) {
    const name = (prop.name || "").toLowerCase();
    if (name.includes("caledonian") && name.includes("edinburgh")) {
      const price = parseRate(prop.rate_per_night);
      console.log(
        `[check-price] matched list "${prop.name}" for ${checkIn}, rate=${JSON.stringify(prop.rate_per_night)}, parsedPrice=${price}`
      );
      if (price) return { price, hotelName: prop.name };
    }
  }

  console.log(`[check-price] no match for ${checkIn}`);
  return { price: null, hotelName: null };
}

function parseRate(rate) {
  if (!rate) return null;
  const priceStr = rate.lowest || rate.before_taxes_fees || rate.extracted_lowest || "";
  let price;
  if (typeof priceStr === "number") {
    price = priceStr;
  } else if (typeof priceStr === "string" && priceStr.length > 0) {
    price = parseFloat(priceStr.replace(/[£$€,]/g, "").trim());
  }
  if ((!price || isNaN(price)) && rate.extracted_lowest) {
    price = rate.extracted_lowest;
  }
  return price && !isNaN(price) ? price : null;
}

async function loadHistory() {
  try {
    const { blobs } = await list({ prefix: CONFIG.blobKey });
    if (blobs.length === 0) {
      console.log("[check-price] loadHistory: no blob found, starting fresh");
      return { nights: {}, totalStay: { prices: [], lowest: null, lowestDate: null } };
    }

    const res = await fetch(blobs[0].url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(
        `[check-price] loadHistory: blob fetch failed ${res.status} — keeping existing entries by aborting save. body=${body.slice(0, 200)}`
      );
      throw new Error(`blob fetch ${res.status}`);
    }
    const data = await res.json();

    if (data.prices && !data.nights) {
      console.log("[check-price] loadHistory: migrating single-night format");
      return {
        nights: {
          "2026-10-24": {
            prices: data.prices,
            lowest: data.lowest,
            lowestDate: data.lowestDate,
          },
        },
        totalStay: { prices: [], lowest: null, lowestDate: null },
      };
    }

    if (!data.totalStay) {
      data.totalStay = { prices: [], lowest: null, lowestDate: null };
    }

    const summary = Object.entries(data.nights || {}).map(
      ([k, v]) => `${k}=${v.prices?.length ?? 0}`
    );
    console.log(`[check-price] loadHistory: loaded ${summary.join(", ") || "(empty)"}`);
    return data;
  } catch (err) {
    console.warn(`[check-price] loadHistory failed: ${errorMessage(err)}`);
    throw err;
  }
}

async function saveHistory(history) {
  const summary = Object.entries(history.nights || {}).map(
    ([k, v]) => `${k}=${v.prices?.length ?? 0}`
  );
  const totalCount = history.totalStay?.prices?.length ?? 0;
  console.log(
    `[check-price] saveHistory: writing ${summary.join(", ") || "(empty)"} totalStay=${totalCount}`
  );
  const result = await put(CONFIG.blobKey, JSON.stringify(history, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  console.log(`[check-price] saveHistory: ok, size=${result.size ?? "?"} pathname=${result.pathname}`);
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

async function sendEmail(nightResults, summary) {
  const apiKey = process.env.RESEND_API_KEY;
  const emailTo = process.env.EMAIL_TO;
  if (!apiKey || !emailTo) return false;

  const resend = new Resend(apiKey);
  const fromAddr = process.env.EMAIL_FROM || "Hotel Tracker <onboarding@resend.dev>";

  const rows = nightResults
    .map((n) => {
      const priceCell = n.price != null ? `$${n.price.toFixed(2)}` : "N/A";
      const lowestCell = n.lowest != null ? `$${n.lowest.toFixed(2)}` : "—";
      const badge = n.isNewLowest ? ' <span style="color:#16a34a;font-weight:bold;">NEW LOW</span>' : "";
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${n.night}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${priceCell}${badge}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#888;">${lowestCell}</td>
      </tr>`;
    })
    .join("");

  const hasNewLow = nightResults.some((n) => n.isNewLowest);
  const hasTargetHit = summary?.targetAlert?.met;
  const subject = hasNewLow
    ? "🏨 New lowest price — The Caledonian Edinburgh"
    : hasTargetHit
      ? "🏨 Target price hit — The Caledonian Edinburgh"
      : "🏨 Price update — The Caledonian Edinburgh";

  const totalStayLine =
    summary?.totalStay?.current != null
      ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Total stay:</strong> $${summary.totalStay.current.toFixed(
          2
        )} (best: ${
          summary.totalStay.lowest != null ? `$${summary.totalStay.lowest.toFixed(2)}` : "N/A"
        })</p>`
      : "";
  const signalLine = summary?.bookingSignal?.label
    ? `<p style="margin:0 0 12px;font-size:14px;"><strong>Recommendation:</strong> ${summary.bookingSignal.label} — ${summary.bookingSignal.reason}</p>`
    : "";
  const targetLine =
    summary?.targetAlert?.enabled && summary?.targetAlert?.targetTotal != null
      ? `<p style="margin:0 0 12px;font-size:14px;"><strong>Target:</strong> $${summary.targetAlert.targetTotal.toFixed(
          2
        )} ${
          summary.targetAlert.met ? '<span style="color:#16a34a;font-weight:700;">(hit)</span>' : ""
        }</p>`
      : "";

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="margin:0 0 4px;">The Caledonian Edinburgh</h2>
      <p style="color:#666;margin:0 0 16px;font-size:14px;">Daily price check · Oct 23–25, 2026</p>
      ${totalStayLine}
      ${signalLine}
      ${targetLine}
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="border-bottom:2px solid #e5e7eb;">
            <th style="padding:8px 12px;text-align:left;color:#888;font-size:12px;text-transform:uppercase;">Night</th>
            <th style="padding:8px 12px;text-align:right;color:#888;font-size:12px;text-transform:uppercase;">Price</th>
            <th style="padding:8px 12px;text-align:right;color:#888;font-size:12px;text-transform:uppercase;">Lowest</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:16px 0 0;font-size:13px;">
        <a href="https://www.hilton.com/en/hotels/ednchqq-the-caledonian-edinburgh/" style="color:#2563eb;">Book here</a>
      </p>
    </div>`;

  try {
    await resend.emails.send({ from: fromAddr, to: emailTo, subject, html });
    return true;
  } catch (err) {
    console.warn("Email send failed:", errorMessage(err));
    return false;
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

        console.log(
          `[check-price] appended ${key}: $${result.price} (total=${allPrices.length}, lowest=$${nightHistory.lowest}, newLow=${isNewLowest})`
        );

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
        console.log(`[check-price] skipped ${key}: no price returned`);
        nightResults.push({
          night: result.label,
          checkIn: result.checkIn,
          price: null,
          error: "Hotel not found in results",
        });
      }
    }

    const completeNightPrices = nightResults
      .filter((n) => n.price != null)
      .map((n) => n.price);
    let totalStaySummary = {
      current: null,
      average: null,
      lowest: history.totalStay?.lowest ?? null,
      isNewLowest: false,
      totalChecks: history.totalStay?.prices?.length ?? 0,
    };

    if (completeNightPrices.length === CONFIG.nights.length) {
      const total = completeNightPrices.reduce((a, b) => a + b, 0);
      if (!history.totalStay) {
        history.totalStay = { prices: [], lowest: null, lowestDate: null };
      }
      history.totalStay.prices.push({ price: total, date: now });
      const totals = history.totalStay.prices.map((p) => p.price);
      const prevLowestTotal = history.totalStay.lowest;
      const isNewLowestTotal = prevLowestTotal === null || total < prevLowestTotal;
      if (isNewLowestTotal) {
        history.totalStay.lowest = total;
        history.totalStay.lowestDate = now;
      }
      totalStaySummary = {
        current: total,
        average: Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100,
        lowest: history.totalStay.lowest,
        isNewLowest: isNewLowestTotal,
        totalChecks: totals.length,
      };
      if (isNewLowestTotal) {
        slackLines.push(
          `> *Total stay (3 nights)*: $${total.toFixed(2)} <- new low! (was ${
            prevLowestTotal !== null ? `$${prevLowestTotal.toFixed(2)}` : "N/A"
          })`
        );
      }
    }

    const bookingSignal = computeBookingSignal(
      totalStaySummary.current,
      totalStaySummary.lowest
    );
    const targetTotal = parseNumberEnv(process.env.TARGET_TOTAL_PRICE);
    const targetAlert = {
      enabled: targetTotal !== null,
      targetTotal,
      met:
        targetTotal !== null &&
        totalStaySummary.current !== null &&
        totalStaySummary.current <= targetTotal,
    };

    await saveHistory(history);

    // Send notifications
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

    const emailSent = await sendEmail(nightResults, {
      totalStay: totalStaySummary,
      bookingSignal,
      targetAlert,
    });

    return Response.json({
      success: true,
      hotel: results.find((r) => r.hotelName)?.hotelName || CONFIG.hotelQuery,
      nights: nightResults,
      totalStay: totalStaySummary,
      bookingSignal,
      targetAlert,
      slackSent,
      emailSent,
      timestamp: now,
    });
  } catch (error) {
    console.error("Price check failed:", errorMessage(error));
    return Response.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
