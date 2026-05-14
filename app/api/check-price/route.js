import { put, list } from "@vercel/blob";
import { Resend } from "resend";
import { getNightRanges } from "../../../lib/trip-config";
import { loadTripConfig } from "../../../lib/trip-config-store";

// ─── CONFIG ───────────────────────────────────────────
const CONFIG = {
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

async function fetchHotelPriceForNight(config, checkIn, checkOut) {
  const params = new URLSearchParams({
    engine: "google_hotels",
    q: config.hotel.query,
    check_in_date: checkIn,
    check_out_date: checkOut,
    adults: String(config.hotel.adults),
    currency: config.hotel.currency,
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

async function fetchFlightPrice(config) {
  const params = new URLSearchParams({
    engine: "google_flights",
    departure_id: config.flight.origin,
    arrival_id: config.flight.destination,
    outbound_date: config.flight.departDate,
    return_date: config.flight.returnDate,
    adults: String(config.flight.adults),
    currency: config.flight.currency,
    travel_class:
      config.flight.cabin === "BUSINESS"
        ? "2"
        : config.flight.cabin === "FIRST"
          ? "4"
          : "1",
    hl: "en",
    gl: "us",
    api_key: process.env.SERPAPI_API_KEY,
  });

  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`SerpApi flight error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const options = [
    ...(Array.isArray(data.best_flights) ? data.best_flights : []),
    ...(Array.isArray(data.other_flights) ? data.other_flights : []),
  ];
  function parseFlightPrice(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number(value.replace(/[$,]/g, "").trim());
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  let best = null;
  let bestOption = null;
  for (const option of options) {
    const p = parseFlightPrice(option?.price);
    if (p != null && (best === null || p < best)) {
      best = p;
      bestOption = option;
    }
  }

  const flights = Array.isArray(bestOption?.flights) ? bestOption.flights : [];
  const firstLeg = flights[0];
  const lastLeg = flights[flights.length - 1];
  const carriers = [...new Set(flights.map((f) => f?.airline).filter(Boolean))];
  const details = bestOption
    ? {
        carriers,
        segments: flights.length || null,
        durationMinutes: bestOption?.total_duration ?? null,
        departureTime: firstLeg?.departure_airport?.time || null,
        arrivalTime: lastLeg?.arrival_airport?.time || null,
        stopCount: Math.max(0, (flights.length || 1) - 1),
        bookingToken:
          typeof bestOption?.booking_token === "string" ? bestOption.booking_token : null,
      }
    : null;
  return {
    price: best,
    rawCount: options.length,
    details,
  };
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
      return {
        hotelNights: {},
        hotelStay: { prices: [], lowest: null, lowestDate: null },
        flight: { prices: [], lowest: null, lowestDate: null },
        combined: { prices: [], lowest: null, lowestDate: null },
      };
    }

    const exact = blobs.find((b) => b.pathname === CONFIG.blobKey);
    const latest =
      exact ||
      [...blobs].sort(
        (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
      )[0];

    const res = await fetch(latest.url, {
      cache: "no-store",
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

    if (data.prices && !data.nights && !data.hotelNights) {
      console.log("[check-price] loadHistory: migrating single-night format");
      return {
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
      };
    }

    if (data.nights && !data.hotelNights) data.hotelNights = data.nights;
    if (data.totalStay && !data.hotelStay) data.hotelStay = data.totalStay;
    if (!data.hotelNights) data.hotelNights = {};
    if (!data.hotelStay) data.hotelStay = { prices: [], lowest: null, lowestDate: null };
    if (!data.flight) data.flight = { prices: [], lowest: null, lowestDate: null };
    if (!data.combined) data.combined = { prices: [], lowest: null, lowestDate: null };

    const summary = Object.entries(data.hotelNights || {}).map(
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
  const summary = Object.entries(history.hotelNights || {}).map(
    ([k, v]) => `${k}=${v.prices?.length ?? 0}`
  );
  const totalCount = history.hotelStay?.prices?.length ?? 0;
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

async function sendEmail(nightResults, summary, tripConfig, flightSummary) {
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

  const hasNewLow =
    nightResults.some((n) => n.isNewLowest) ||
    Boolean(summary?.hotelStay?.isNewLowest) ||
    Boolean(flightSummary?.isNewLowest) ||
    Boolean(summary?.combined?.isNewLowest);
  const hasTargetHit = summary?.targetAlert?.met;
  const subject = hasNewLow
    ? `🏨 New lowest price — ${tripConfig.hotel.query}`
    : hasTargetHit
      ? `🏨 Target price hit — ${tripConfig.hotel.query}`
      : `🏨 Price update — ${tripConfig.hotel.query}`;

  const totalStayLine =
    summary?.hotelStay?.current != null
      ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Hotel stay:</strong> $${summary.hotelStay.current.toFixed(
          2
        )} (best: ${
          summary.hotelStay.lowest != null ? `$${summary.hotelStay.lowest.toFixed(2)}` : "N/A"
        })</p>`
      : "";
  const flightLine =
    flightSummary?.current != null
      ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Flights:</strong> $${flightSummary.current.toFixed(
          2
        )} (best: ${flightSummary.lowest != null ? `$${flightSummary.lowest.toFixed(2)}` : "N/A"})</p>`
      : "";
  const combinedLine =
    summary?.combined?.current != null
      ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Combined trip:</strong> $${summary.combined.current.toFixed(
          2
        )} (best: ${
          summary.combined.lowest != null ? `$${summary.combined.lowest.toFixed(2)}` : "N/A"
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
      <h2 style="margin:0 0 4px;">${tripConfig.hotel.query}</h2>
      <p style="color:#666;margin:0 0 16px;font-size:14px;">Trip check update</p>
      ${totalStayLine}
      ${flightLine}
      ${combinedLine}
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
        <a href="https://www.google.com/travel/flights" style="color:#2563eb;">Check flights</a>
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
    const tripConfig = await loadTripConfig();
    const nights = getNightRanges(tripConfig.hotel.checkIn, tripConfig.hotel.checkOut);
    const hotelEnabled = tripConfig.hotel.enabled !== false;
    const flightEnabled = tripConfig.flight.enabled !== false;

    const results = hotelEnabled
      ? await Promise.all(
          nights.map(async (night) => {
            const { price, hotelName } = await fetchHotelPriceForNight(
              tripConfig,
              night.checkIn,
              night.checkOut
            );
            return { ...night, price, hotelName };
          })
        )
      : [];

    const flightResult = flightEnabled
      ? await fetchFlightPrice(tripConfig)
      : { price: null, rawCount: 0, details: null };

    const history = await loadHistory();
    const now = new Date().toISOString();
    let slackSent = false;
    const nightResults = [];
    const slackLines = [];

    for (const result of results) {
      const key = result.checkIn;

      if (!history.hotelNights[key]) {
        history.hotelNights[key] = { prices: [], lowest: null, lowestDate: null };
      }

      const nightHistory = history.hotelNights[key];

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
      lowest: history.hotelStay?.lowest ?? null,
      isNewLowest: false,
      totalChecks: history.hotelStay?.prices?.length ?? 0,
    };

    if (completeNightPrices.length > 0 && completeNightPrices.length === nights.length) {
      const total = completeNightPrices.reduce((a, b) => a + b, 0);
      if (!history.hotelStay) {
        history.hotelStay = { prices: [], lowest: null, lowestDate: null };
      }
      history.hotelStay.prices.push({ price: total, date: now });
      const totals = history.hotelStay.prices.map((p) => p.price);
      const prevLowestTotal = history.hotelStay.lowest;
      const isNewLowestTotal = prevLowestTotal === null || total < prevLowestTotal;
      if (isNewLowestTotal) {
        history.hotelStay.lowest = total;
        history.hotelStay.lowestDate = now;
      }
      totalStaySummary = {
        current: total,
        average: Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100,
        lowest: history.hotelStay.lowest,
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

    let flightSummary = {
      current: null,
      average: null,
      lowest: history.flight?.lowest ?? null,
      isNewLowest: false,
      totalChecks: history.flight?.prices?.length ?? 0,
    };
    if (flightResult.price != null) {
      history.flight.prices.push({
        price: flightResult.price,
        date: now,
        details: flightResult.details,
      });
      const fares = history.flight.prices.map((p) => p.price);
      const prevLowest = history.flight.lowest;
      const isNewLowest = prevLowest === null || flightResult.price < prevLowest;
      if (isNewLowest) {
        history.flight.lowest = flightResult.price;
        history.flight.lowestDate = now;
      }
      flightSummary = {
        current: flightResult.price,
        average: Math.round((fares.reduce((a, b) => a + b, 0) / fares.length) * 100) / 100,
        lowest: history.flight.lowest,
        isNewLowest,
        totalChecks: fares.length,
        details: flightResult.details,
      };
      if (isNewLowest) {
        slackLines.push(
          `> *Flights ${tripConfig.flight.origin}->${tripConfig.flight.destination}*: $${flightResult.price.toFixed(
            2
          )} <- new low! (was ${prevLowest !== null ? `$${prevLowest.toFixed(2)}` : "N/A"})`
        );
      }
    }

    let combinedSummary = {
      current: null,
      average: null,
      lowest: history.combined?.lowest ?? null,
      isNewLowest: false,
      totalChecks: history.combined?.prices?.length ?? 0,
    };
    if (totalStaySummary.current != null || flightSummary.current != null) {
      const combinedCurrent =
        (totalStaySummary.current != null ? totalStaySummary.current : 0) +
        (flightSummary.current != null ? flightSummary.current : 0);
      history.combined.prices.push({ price: combinedCurrent, date: now });
      const vals = history.combined.prices.map((p) => p.price);
      const prevLowest = history.combined.lowest;
      const isNewLowest = prevLowest === null || combinedCurrent < prevLowest;
      if (isNewLowest) {
        history.combined.lowest = combinedCurrent;
        history.combined.lowestDate = now;
      }
      combinedSummary = {
        current: combinedCurrent,
        average: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
        lowest: history.combined.lowest,
        isNewLowest,
        totalChecks: vals.length,
      };
      if (isNewLowest) {
        slackLines.push(
          `> *Combined trip total*: $${combinedCurrent.toFixed(2)} <- new low! (was ${
            prevLowest !== null ? `$${prevLowest.toFixed(2)}` : "N/A"
          })`
        );
      }
    }

    const bookingSignal = computeBookingSignal(combinedSummary.current, combinedSummary.lowest);
    const targetTotal =
      tripConfig.alerts?.targetCombinedPrice ?? parseNumberEnv(process.env.TARGET_TOTAL_PRICE);
    const targetAlert = {
      enabled: targetTotal !== null,
      targetTotal,
      met:
        targetTotal !== null &&
        combinedSummary.current !== null &&
        combinedSummary.current <= targetTotal,
    };

    await saveHistory(history);

    // Send notifications
    if (slackLines.length > 0) {
      const message = [
        `🏨 *New lowest trip price found — ${tripConfig.hotel.query}*`,
        ``,
        ...slackLines,
        ``,
        `✈️ ${tripConfig.flight.origin} -> ${tripConfig.flight.destination} (${tripConfig.flight.departDate} to ${tripConfig.flight.returnDate})`,
      ].join("\n");

      slackSent = await sendSlack(message);
    }

    const emailSent = await sendEmail(
      nightResults,
      {
        hotelStay: totalStaySummary,
        combined: combinedSummary,
        bookingSignal,
        targetAlert,
      },
      tripConfig,
      flightSummary
    );

    return Response.json({
      success: true,
      config: tripConfig,
      hotel: {
        name: results.find((r) => r.hotelName)?.hotelName || tripConfig.hotel.query,
        nights: nightResults,
        totalStay: totalStaySummary,
      },
      flight: {
        route: `${tripConfig.flight.origin}-${tripConfig.flight.destination}`,
        ...flightSummary,
        rawCount: flightResult.rawCount,
        details: flightResult.details,
      },
      combined: combinedSummary,
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
