"use client";

import { useState, useEffect, useCallback } from "react";

export default function DashboardClient() {
  const [history, setHistory] = useState(null);
  const [usage, setUsage] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const bust = `t=${Date.now()}`;
    const [histRes, usageRes] = await Promise.all([
      fetch(`/api/price-history?${bust}`, { cache: "no-store" }),
      fetch(`/api/serpapi-usage?${bust}`, { cache: "no-store" }),
    ]);
    setHistory(await histRes.json());
    setUsage(await usageRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleCheck() {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/check-price", { cache: "no-store" });
      const data = await res.json();
      setCheckResult(data);
      await fetchData();
    } catch (err) {
      setCheckResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setChecking(false);
    }
  }

  const hotelNights = history?.hotelNights || {};
  const keys = Object.keys(hotelNights).sort();
  const labels = {};
  for (const key of keys) {
    labels[key] = new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  const allDates = new Set();
  for (const key of keys) {
    for (const entry of hotelNights[key]?.prices || []) allDates.add(entry.date);
  }
  const timeline = [...allDates].sort((a, b) => new Date(b) - new Date(a));
  const priceLookup = {};
  for (const key of keys) {
    for (const entry of hotelNights[key]?.prices || []) {
      if (!priceLookup[entry.date]) priceLookup[entry.date] = {};
      priceLookup[entry.date][key] = entry.price;
    }
  }

  const hotelStay = checkResult?.hotel?.totalStay || {
    current: history?.hotelStay?.prices?.at?.(-1)?.price ?? null,
    lowest: history?.hotelStay?.lowest ?? null,
    totalChecks: history?.hotelStay?.prices?.length ?? 0,
  };
  const flight = checkResult?.flight || {
    current: history?.flight?.prices?.at?.(-1)?.price ?? null,
    lowest: history?.flight?.lowest ?? null,
    totalChecks: history?.flight?.prices?.length ?? 0,
    details: history?.flight?.prices?.at?.(-1)?.details ?? null,
    filteredOut: 0,
  };
  const combined = checkResult?.combined || {
    current: history?.combined?.prices?.at?.(-1)?.price ?? null,
    lowest: history?.combined?.lowest ?? null,
    totalChecks: history?.combined?.prices?.length ?? 0,
  };
  const recommendation =
    checkResult?.bookingSignal || computeBookingSignal(combined.current, combined.lowest);
  const flightRoute = checkResult?.flight?.route || inferFlightRoute(history?.config);
  const lastCheckedAt =
    history?.combined?.prices?.at?.(-1)?.date ||
    history?.hotelStay?.prices?.at?.(-1)?.date ||
    history?.flight?.prices?.at?.(-1)?.date ||
    null;

  if (loading) return <div style={s.container}>Loading…</div>;

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Trip Price Dashboard</h1>
          <p style={s.sub}>
            Hotel + flights in one place{flightRoute ? ` · ${flightRoute}` : ""}
          </p>
          {lastCheckedAt && (
            <p style={s.lastCheck}>
              Last checked{" "}
              {new Date(lastCheckedAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/config" style={{ ...s.btn, ...s.secondary, textDecoration: "none" }}>Config</a>
          <button onClick={handleCheck} disabled={checking} style={s.btn}>
            {checking ? "Checking…" : "Check Now"}
          </button>
        </div>
      </div>

      {checkResult && (
        <div style={{ ...s.toast, borderLeft: `4px solid ${checkResult.success ? "#16a34a" : "#dc2626"}` }}>
          {checkResult.success ? "Trip prices updated." : `Error: ${checkResult.error || "Unknown error"}`}
        </div>
      )}

      <div style={s.usageBar}>
        <span style={s.usageLabel}>SerpApi</span>
        {usage?.error ? (
          <span style={{ color: "#dc2626" }}>{usage.error}</span>
        ) : (
          <span>
            <strong>{usage?.remaining?.toLocaleString() ?? "?"}</strong> searches remaining
            {usage?.plan ? ` · ${usage.plan}` : ""} · 4 per check
          </span>
        )}
      </div>

      {(recommendation || combined.current != null) && (
        <div
          style={{
            ...s.reco,
            borderLeft: `4px solid ${
              recommendation?.action === "book_now"
                ? "#16a34a"
                : recommendation?.action === "consider"
                  ? "#f59e0b"
                  : "#6b7280"
            }`,
          }}
        >
          <div style={{ fontWeight: 700 }}>{recommendation?.label || "Recommendation pending"}</div>
          <div style={{ fontSize: "0.9rem", color: "#4b5563" }}>
            Combined: {fmt(combined.current)} · Best: {fmt(combined.lowest)}
          </div>
          {recommendation?.reason && <div style={{ fontSize: "0.82rem", color: "#6b7280" }}>{recommendation.reason}</div>}
        </div>
      )}

      <div style={s.statsRow}>
        <Stat title="Hotel Stay" current={hotelStay.current} low={hotelStay.lowest} checks={hotelStay.totalChecks} />
        <Stat title="Flights" current={flight.current} low={flight.lowest} checks={flight.totalChecks} />
        <Stat title="Combined Trip" current={combined.current} low={combined.lowest} checks={combined.totalChecks} />
      </div>

      {flight.current != null && (
        <div style={s.flightNote}>
          Current flight estimate: <strong>{fmt(flight.current)}</strong>
          {flightRoute ? ` for ${flightRoute}` : ""} · best seen {fmt(flight.lowest)}
          {flight.filteredOut ? ` · filtered out ${flight.filteredOut} options` : ""}
        </div>
      )}

      {(history?.flight?.prices?.length || 0) > 0 && (
        <>
          <h2 style={s.sectionTitle}>Flight History</h2>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, textAlign: "left" }}>#</th>
                <th style={{ ...s.th, textAlign: "left" }}>Date Checked</th>
                <th style={{ ...s.th, textAlign: "right" }}>Price</th>
                <th style={{ ...s.th, textAlign: "left" }}>Carriers</th>
                <th style={{ ...s.th, textAlign: "right" }}>Stops</th>
                <th style={{ ...s.th, textAlign: "right" }}>Duration</th>
                <th style={{ ...s.th, textAlign: "left" }}>Timing</th>
                <th style={{ ...s.th, textAlign: "left" }}>Layovers</th>
              </tr>
            </thead>
            <tbody>
              {[...(history?.flight?.prices || [])]
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .map((entry, i) => {
                  const isLowest = entry.price === history?.flight?.lowest;
                  return (
                    <tr key={`${entry.date}-${i}`}>
                      <td style={s.td}>{(history?.flight?.prices?.length || 0) - i}</td>
                      <td style={s.td}>
                        {new Date(entry.date).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td
                        style={{
                          ...s.td,
                          textAlign: "right",
                          color: isLowest ? "#16a34a" : "#111",
                          fontWeight: isLowest ? 700 : 500,
                        }}
                      >
                        {fmt(entry.price)}
                      </td>
                      <td style={s.td}>
                        {entry.details?.carriers?.length
                          ? entry.details.carriers.join(", ")
                          : "—"}
                      </td>
                      <td style={{ ...s.td, textAlign: "right" }}>
                        {entry.details?.stopCount != null ? entry.details.stopCount : "—"}
                      </td>
                      <td style={{ ...s.td, textAlign: "right" }}>
                        {fmtMinutes(entry.details?.durationMinutes)}
                      </td>
                      <td style={s.td}>
                        {entry.details?.departureTime || entry.details?.arrivalTime
                          ? `${entry.details?.departureTime || "?"} -> ${
                              entry.details?.arrivalTime || "?"
                            }`
                          : "—"}
                      </td>
                      <td style={s.td}>
                        {entry.details?.layovers?.length
                          ? entry.details.layovers
                              .map((l) =>
                                l.fromArrival && l.toDeparture
                                  ? `${l.airport} (${l.fromArrival} -> ${l.toDeparture})`
                                  : `${l.airport}`
                              )
                              .join(" | ")
                          : "Non-stop / none"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </>
      )}

      {timeline.length === 0 ? (
        <p style={s.empty}>No hotel history yet. Run a check to populate data.</p>
      ) : (
        <>
        <h2 style={s.sectionTitle}>Hotel Nightly History</h2>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, textAlign: "left" }}>#</th>
              <th style={{ ...s.th, textAlign: "left" }}>Date Checked</th>
              {keys.map((k) => (
                <th key={k} style={{ ...s.th, textAlign: "right" }}>{labels[k]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeline.map((date, i) => {
              const row = priceLookup[date] || {};
              return (
                <tr key={date}>
                  <td style={s.td}>{timeline.length - i}</td>
                  <td style={s.td}>
                    {new Date(date).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  {keys.map((k) => {
                    const price = row[k];
                    const isLow = price != null && price === hotelNights[k]?.lowest;
                    return (
                      <td
                        key={k}
                        style={{
                          ...s.td,
                          textAlign: "right",
                          color: isLow ? "#16a34a" : price != null ? "#111" : "#bbb",
                          background: isLow ? "#f0fdf4" : "transparent",
                          fontWeight: isLow ? 600 : 400,
                        }}
                      >
                        {price != null ? fmt(price) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
}

function Stat({ title, current, low, checks }) {
  return (
    <div style={s.stat}>
      <div style={s.statLabel}>{title}</div>
      <div style={s.statValue}>{fmt(current)}</div>
      <div style={s.statMeta}>Low: {fmt(low)} · {checks || 0} checks</div>
    </div>
  );
}

function fmt(v) {
  return v == null ? "—" : `$${Number(v).toFixed(2)}`;
}

function fmtMinutes(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const mins = Number(v);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function computeBookingSignal(current, lowest) {
  if (current == null || lowest == null || lowest <= 0) {
    return {
      action: "insufficient_data",
      label: "Need more data",
      reason: "Run more checks to establish a stronger baseline.",
    };
  }
  const deltaPct = ((current - lowest) / lowest) * 100;
  if (deltaPct <= 2) {
    return {
      action: "book_now",
      label: "Book now",
      reason: "Current total is within 2% of the best seen trip price.",
    };
  }
  if (deltaPct <= 5) {
    return {
      action: "consider",
      label: "Consider booking",
      reason: "Current total is close to your best seen trip price.",
    };
  }
  return {
    action: "wait",
    label: "Wait",
    reason: "Current total is still above the best seen trip price.",
  };
}

function inferFlightRoute(config) {
  if (!config?.flight?.origin || !config?.flight?.destination) return "";
  return `${config.flight.origin} -> ${config.flight.destination}`;
}

const s = {
  container: {
    maxWidth: 860,
    margin: "0 auto",
    padding: "2rem 1.25rem",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  h1: { margin: 0, fontSize: "1.7rem" },
  sub: { margin: "0.25rem 0 0", color: "#666" },
  lastCheck: { margin: "0.25rem 0 0", fontSize: "0.82rem", color: "#888" },
  btn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "0.55rem 1rem",
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
  },
  secondary: {
    background: "#fff",
    color: "#111",
    border: "1px solid #d1d5db",
  },
  toast: {
    background: "#f8fafc",
    borderRadius: 8,
    marginTop: 12,
    marginBottom: 12,
    padding: "0.7rem 0.9rem",
  },
  usageBar: {
    background: "#f8f9fa",
    borderRadius: 8,
    marginBottom: 12,
    padding: "0.6rem 0.9rem",
    fontSize: "0.88rem",
  },
  usageLabel: {
    fontWeight: 700,
    textTransform: "uppercase",
    fontSize: "0.72rem",
    marginRight: 8,
    color: "#666",
  },
  reco: {
    background: "#f9fafb",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    marginBottom: 12,
  },
  flightNote: {
    marginBottom: 12,
    color: "#4b5563",
    fontSize: "0.88rem",
    background: "#f9fafb",
    borderRadius: 8,
    padding: "0.6rem 0.9rem",
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 14,
  },
  stat: {
    background: "#f8f9fa",
    borderRadius: 8,
    padding: "0.75rem 0.9rem",
  },
  statLabel: { fontSize: "0.75rem", textTransform: "uppercase", color: "#777", marginBottom: 2 },
  statValue: { fontSize: "1.35rem", fontWeight: 700 },
  statMeta: { fontSize: "0.78rem", color: "#666" },
  empty: { background: "#f5f5f5", borderRadius: 8, padding: "1rem", color: "#777" },
  sectionTitle: { margin: "0.75rem 0 0.5rem", fontSize: "1rem" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" },
  th: {
    borderBottom: "2px solid #e5e7eb",
    padding: "0.6rem 0.65rem",
    fontSize: "0.75rem",
    textTransform: "uppercase",
    color: "#888",
  },
  td: { borderBottom: "1px solid #f0f0f0", padding: "0.6rem 0.65rem" },
};
