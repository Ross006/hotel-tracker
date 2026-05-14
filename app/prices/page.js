"use client";

import { useState, useEffect, useCallback } from "react";

const NIGHTS = ["2026-10-23", "2026-10-24", "2026-10-25"];
const LABELS = { "2026-10-23": "Oct 23", "2026-10-24": "Oct 24", "2026-10-25": "Oct 25" };

export default function PricesPage() {
  const [history, setHistory] = useState(null);
  const [usage, setUsage] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [debugging, setDebugging] = useState(false);
  const [debugResult, setDebugResult] = useState(null);

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
      const res = await fetch("/api/check-price");
      const data = await res.json();
      setCheckResult(data);
      await fetchData();
    } catch (err) {
      setCheckResult({ success: false, error: err.message });
    } finally {
      setChecking(false);
    }
  }

  async function handleDebug() {
    setDebugging(true);
    setDebugResult(null);
    try {
      const res = await fetch("/api/debug-serpapi");
      const data = await res.json();
      setDebugResult(data);
    } catch (err) {
      setDebugResult({ error: err.message });
    } finally {
      setDebugging(false);
    }
  }

  const nights = history?.nights || {};

  // Build unified timeline: all unique timestamps across all nights
  const allDates = new Set();
  for (const key of NIGHTS) {
    for (const entry of nights[key]?.prices || []) {
      allDates.add(entry.date);
    }
  }
  const timeline = [...allDates].sort((a, b) => new Date(b) - new Date(a));

  // Build price lookup: { date -> { night -> price } }
  const priceLookup = {};
  for (const key of NIGHTS) {
    for (const entry of nights[key]?.prices || []) {
      if (!priceLookup[entry.date]) priceLookup[entry.date] = {};
      priceLookup[entry.date][key] = entry.price;
    }
  }

  if (loading) {
    return (
      <div style={s.container}>
        <p style={{ color: "#888" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <h1 style={s.heading}>The Caledonian Edinburgh</h1>
          <p style={s.subtitle}>Price History · 3 nights tracked</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={handleDebug}
            disabled={debugging}
            style={{
              ...s.button,
              ...s.buttonSecondary,
              opacity: debugging ? 0.6 : 1,
              cursor: debugging ? "wait" : "pointer",
            }}
          >
            {debugging ? "Loading…" : "Debug"}
          </button>
          <button
            onClick={handleCheck}
            disabled={checking}
            style={{
              ...s.button,
              opacity: checking ? 0.6 : 1,
              cursor: checking ? "wait" : "pointer",
            }}
          >
            {checking ? "Checking…" : "Check Now"}
          </button>
        </div>
      </div>

      {checkResult && (
        <div
          style={{
            ...s.toast,
            borderLeft: `4px solid ${checkResult.success ? "#16a34a" : "#dc2626"}`,
          }}
        >
          {checkResult.success ? (
            <span>
              Prices updated!
              {checkResult.nights?.some((n) => n.isNewLowest) && " New lowest found! 🎉"}
              {checkResult.totalStay?.isNewLowest && " Total stay is at a new low! 🎯"}
              {checkResult.targetAlert?.met && " Target hit!"}
              {checkResult.slackSent && " (Slack notified)"}
            </span>
          ) : (
            <span>Error: {checkResult.error || "Unknown error"}</span>
          )}
          <button onClick={() => setCheckResult(null)} style={s.toastClose}>
            ✕
          </button>
        </div>
      )}

      {debugResult && (
        <div style={s.debugPanel}>
          <div style={s.debugHeader}>
            <strong style={{ fontSize: "0.85rem" }}>SerpApi debug</strong>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "#888" }}>
                {debugResult.propertyCount != null
                  ? `${debugResult.propertyCount} properties`
                  : debugResult.error || "—"}
              </span>
              <button onClick={() => setDebugResult(null)} style={s.toastClose}>
                ✕
              </button>
            </div>
          </div>
          {debugResult.caledonianOrPrincesStreetMatches?.length > 0 && (
            <div style={{ marginBottom: "0.5rem" }}>
              <div style={s.debugSubhead}>Caledonian / Princes Street matches</div>
              {debugResult.caledonianOrPrincesStreetMatches.map((m, i) => (
                <div key={i} style={s.debugMatch}>
                  <span>{m.name}</span>
                  <span style={{ color: "#666" }}>
                    {m.rate_per_night?.lowest || m.rate_per_night?.extracted_lowest || "no rate"}
                  </span>
                </div>
              ))}
            </div>
          )}
          <pre style={s.debugPre}>{JSON.stringify(debugResult, null, 2)}</pre>
        </div>
      )}

      {/* API Usage */}
      <div style={s.usageBar}>
        <span style={s.usageLabel}>SerpApi</span>
        {usage?.error ? (
          <span style={{ color: "#dc2626", fontSize: "0.85rem" }}>
            {usage.error}
          </span>
        ) : usage ? (
          <span style={s.usageText}>
            <strong>{usage.remaining?.toLocaleString() ?? "?"}</strong> searches
            remaining
            {usage.plan && (
              <span style={{ color: "#999" }}> · {usage.plan}</span>
            )}
            <span style={{ color: "#999" }}> · 3 per check</span>
          </span>
        ) : null}
      </div>

      {checkResult?.totalStay?.current != null && (
        <div
          style={{
            ...s.recoBox,
            borderLeft: `4px solid ${
              checkResult.bookingSignal?.action === "book_now"
                ? "#16a34a"
                : checkResult.bookingSignal?.action === "consider"
                  ? "#f59e0b"
                  : "#6b7280"
            }`,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {checkResult.bookingSignal?.label || "Recommendation unavailable"}
          </div>
          <div style={{ fontSize: "0.88rem", color: "#4b5563" }}>
            Total stay: ${checkResult.totalStay.current.toFixed(2)}
            {checkResult.totalStay.lowest != null &&
              ` · Best seen: $${checkResult.totalStay.lowest.toFixed(2)} · Delta: ${
                checkResult.bookingSignal?.deltaPct != null
                  ? `${checkResult.bookingSignal.deltaPct.toFixed(2)}%`
                  : "N/A"
              }`}
          </div>
          {checkResult.bookingSignal?.reason && (
            <div style={{ fontSize: "0.82rem", color: "#6b7280", marginTop: 4 }}>
              {checkResult.bookingSignal.reason}
            </div>
          )}
          {checkResult.targetAlert?.enabled && (
            <div style={{ fontSize: "0.82rem", color: "#374151", marginTop: 6 }}>
              Target total: ${checkResult.targetAlert.targetTotal?.toFixed(2)}{" "}
              {checkResult.targetAlert.met ? "(hit)" : "(not hit yet)"}
            </div>
          )}
        </div>
      )}

      {/* Per-night stats */}
      <div style={s.statsRow}>
        {checkResult?.totalStay?.current != null && (
          <div key="total-stay" style={s.stat}>
            <div style={s.statLabel}>Total Stay (3 nights)</div>
            <div style={s.statValue}>${checkResult.totalStay.current.toFixed(2)}</div>
            <div style={s.statMeta}>
              Low: $
              {checkResult.totalStay.lowest != null
                ? checkResult.totalStay.lowest.toFixed(2)
                : "N/A"}{" "}
              · {checkResult.totalStay.totalChecks} checks
            </div>
          </div>
        )}
        {NIGHTS.map((key) => {
          const data = nights[key];
          const prices = data?.prices?.map((p) => p.price) || [];
          const lowest = data?.lowest;
          const latest = prices.length ? data.prices[data.prices.length - 1]?.price : null;
          return (
            <div key={key} style={s.stat}>
              <div style={s.statLabel}>{LABELS[key]}</div>
              {latest != null ? (
                <>
                  <div style={s.statValue}>${latest.toFixed(2)}</div>
                  <div style={s.statMeta}>
                    Low: ${lowest?.toFixed(2)} · {prices.length} checks
                  </div>
                </>
              ) : (
                <div style={{ ...s.statValue, color: "#ccc" }}>—</div>
              )}
            </div>
          );
        })}
      </div>

      {timeline.length === 0 ? (
        <p style={s.empty}>
          No price data yet. Hit <strong>Check Now</strong> to run the first check.
        </p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, textAlign: "left" }}>#</th>
              <th style={{ ...s.th, textAlign: "left" }}>Date Checked</th>
              {NIGHTS.map((key) => (
                <th key={key} style={{ ...s.th, textAlign: "right" }}>
                  {LABELS[key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeline.map((date, i) => {
              const row = priceLookup[date] || {};
              return (
                <tr key={date} style={s.row}>
                  <td style={{ ...s.td, color: "#999" }}>{timeline.length - i}</td>
                  <td style={s.td}>
                    {new Date(date).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  {NIGHTS.map((key) => {
                    const price = row[key];
                    const isLowest = price != null && price === nights[key]?.lowest;
                    return (
                      <td
                        key={key}
                        style={{
                          ...s.td,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          background: isLowest ? "#f0fdf4" : "transparent",
                          color: isLowest ? "#16a34a" : price != null ? "#111" : "#ccc",
                          fontWeight: isLowest ? 600 : 400,
                        }}
                      >
                        {price != null ? `$${price.toFixed(2)}` : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const s = {
  container: {
    maxWidth: 740,
    margin: "0 auto",
    padding: "2.5rem 1.5rem",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "1.5rem",
  },
  heading: { fontSize: "1.6rem", fontWeight: 700, margin: 0 },
  subtitle: { color: "#666", margin: "0.25rem 0 0", fontSize: "0.95rem" },
  button: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "0.6rem 1.2rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  buttonSecondary: {
    background: "#fff",
    color: "#111",
    border: "1px solid #d1d5db",
  },
  debugPanel: {
    background: "#0b1020",
    color: "#e5e7eb",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    marginBottom: "1.25rem",
    fontSize: "0.8rem",
  },
  debugHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.5rem",
    color: "#e5e7eb",
  },
  debugSubhead: {
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#9ca3af",
    marginBottom: 4,
  },
  debugMatch: {
    display: "flex",
    justifyContent: "space-between",
    padding: "2px 0",
    fontSize: "0.8rem",
  },
  debugPre: {
    margin: 0,
    maxHeight: 360,
    overflow: "auto",
    fontSize: "0.72rem",
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  recoBox: {
    background: "#f9fafb",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    marginBottom: "1rem",
  },
  toast: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#f8f9fa",
    padding: "0.75rem 1rem",
    borderRadius: 8,
    marginBottom: "1.25rem",
    fontSize: "0.9rem",
  },
  toastClose: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#999",
    fontSize: "1rem",
    padding: "0 0 0 1rem",
  },
  usageBar: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    background: "#f8f9fa",
    padding: "0.6rem 1rem",
    borderRadius: 8,
    marginBottom: "1.5rem",
    fontSize: "0.85rem",
  },
  usageLabel: {
    fontWeight: 700,
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#888",
  },
  usageText: { fontSize: "0.85rem", color: "#444" },
  empty: {
    color: "#888",
    background: "#f5f5f5",
    padding: "1.5rem",
    borderRadius: 8,
    textAlign: "center",
  },
  statsRow: { display: "flex", gap: "1rem", marginBottom: "1.5rem" },
  stat: {
    flex: 1,
    background: "#f8f9fa",
    borderRadius: 8,
    padding: "0.75rem 1rem",
  },
  statLabel: {
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#888",
    marginBottom: 2,
  },
  statValue: {
    fontSize: "1.25rem",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  statMeta: {
    fontSize: "0.7rem",
    color: "#999",
    marginTop: 2,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" },
  th: {
    padding: "0.6rem 0.75rem",
    borderBottom: "2px solid #e5e7eb",
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#888",
  },
  td: { padding: "0.6rem 0.75rem", borderBottom: "1px solid #f0f0f0" },
  row: {},
};
