const DEFAULT_TRIP_CONFIG = {
  hotel: {
    enabled: true,
    query: "The Caledonian Edinburgh",
    checkIn: "2026-10-23",
    checkOut: "2026-10-26",
    adults: 2,
    currency: "USD",
  },
  flight: {
    enabled: true,
    origin: "SFO",
    destination: "EDI",
    departDate: "2026-10-23",
    returnDate: "2026-10-26",
    adults: 1,
    cabin: "ECONOMY",
    currency: "USD",
  },
  alerts: {
    targetCombinedPrice: null,
  },
};

function asBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asString(value, fallback) {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return fallback;
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asNullableNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTripConfig(raw = {}) {
  const hotel = raw.hotel || {};
  const flight = raw.flight || {};
  const alerts = raw.alerts || {};

  return {
    hotel: {
      enabled: asBoolean(hotel.enabled, DEFAULT_TRIP_CONFIG.hotel.enabled),
      query: asString(hotel.query, DEFAULT_TRIP_CONFIG.hotel.query),
      checkIn: asString(hotel.checkIn, DEFAULT_TRIP_CONFIG.hotel.checkIn),
      checkOut: asString(hotel.checkOut, DEFAULT_TRIP_CONFIG.hotel.checkOut),
      adults: asNumber(hotel.adults, DEFAULT_TRIP_CONFIG.hotel.adults),
      currency: asString(hotel.currency, DEFAULT_TRIP_CONFIG.hotel.currency),
    },
    flight: {
      enabled: asBoolean(flight.enabled, DEFAULT_TRIP_CONFIG.flight.enabled),
      origin: asString(flight.origin, DEFAULT_TRIP_CONFIG.flight.origin).toUpperCase(),
      destination: asString(
        flight.destination,
        DEFAULT_TRIP_CONFIG.flight.destination
      ).toUpperCase(),
      departDate: asString(flight.departDate, DEFAULT_TRIP_CONFIG.flight.departDate),
      returnDate: asString(flight.returnDate, DEFAULT_TRIP_CONFIG.flight.returnDate),
      adults: asNumber(flight.adults, DEFAULT_TRIP_CONFIG.flight.adults),
      cabin: asString(flight.cabin, DEFAULT_TRIP_CONFIG.flight.cabin).toUpperCase(),
      currency: asString(flight.currency, DEFAULT_TRIP_CONFIG.flight.currency),
    },
    alerts: {
      targetCombinedPrice: asNullableNumber(
        alerts.targetCombinedPrice,
        DEFAULT_TRIP_CONFIG.alerts.targetCombinedPrice
      ),
    },
  };
}

function getNightRanges(checkIn, checkOut) {
  const nights = [];
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return nights;
  }

  const cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 1);
    const cIn = cursor.toISOString().slice(0, 10);
    const cOut = next.toISOString().slice(0, 10);
    const label = cursor.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    nights.push({ checkIn: cIn, checkOut: cOut, label });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

export { DEFAULT_TRIP_CONFIG, normalizeTripConfig, getNightRanges };
