"use client";

import { useState, useEffect, useCallback } from "react";

export default function PricesPage() {
  const [history, setHistory] = useState(null);
  const [usage, setUsage] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [histRes, usageRes] = await Promise.all([
      fetch("/api/price-history"),
      fetch("/api/serpapi-usage"),
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

  const prices = history?.prices || [];
  const sorted = [...prices].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
  const lowest = history?.lowest;
  const allPrices = prices.map((p) => p.price);
  const highest = allPrices.length ? Math.max(...allPrices) : null;
  const average = allPrices.length
    ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length
    : null;

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
          <p style={s.subtitle}>Oct 24 – 25, 2026 · Price History</p>
        </div>
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

      {checkResult && (
        <div
          style={{
            ...s.toast,
            borderLeft: `4px solid ${checkResult.success ? "#16a34a" : "#dc2626"}`,
          }}
        >
          {checkResult.success ? (
            <span>
              Got <strong>${checkResult.currentPrice?.toFixed(2)}</strong>
              {checkResult.isNewLowest && " — new lowest! 🎉"}
              {checkResult.slackSent && " (Slack notified)"}
            </span>
          ) : (
            <span>
              Error: {checkResult.error || checkResult.message || "Unknown error"}
            </span>
          )}
          <button
            onClick={() => setCheckResult(null)}
            style={s.toastClose}
          >
            ✕
          </button>
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
          </span>
        ) : null}
      </div>

      {prices.length === 0 ? (
        <p style={s.empty}>
          No price data yet. Hit <strong>Check Now</strong> to run the first
          check.
        </p>
      ) : (
        <>
          <div style={s.statsRow}>
            <Stat label="Lowest" value={lowest} color="#16a34a" />
            <Stat label="Average" value={average} color="#2563eb" />
            <Stat label="Highest" value={highest} color="#dc2626" />
            <Stat label="Checks" value={prices.length} plain />
          </div>

          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, textAlign: "left" }}>#</th>
                <th style={{ ...s.th, textAlign: "left" }}>Date</th>
                <th style={{ ...s.th, textAlign: "right" }}>Price</th>
                <th style={{ ...s.th, textAlign: "right" }}>vs Lowest</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry, i) => {
                const diff = entry.price - lowest;
                const isLowest = entry.price === lowest;
                return (
                  <tr
                    key={i}
                    style={isLowest ? s.highlightRow : s.row}
                  >
                    <td style={{ ...s.td, color: "#999" }}>
                      {prices.length - i}
                    </td>
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
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      ${entry.price.toFixed(2)}
                    </td>
                    <td
                      style={{
                        ...s.td,
                        textAlign: "right",
                        color: isLowest ? "#16a34a" : "#999",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {isLowest ? "★ lowest" : `+$${diff.toFixed(2)}`}
                    </td>
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

function Stat({ label, value, color, plain }) {
  return (
    <div style={s.stat}>
      <div style={s.statLabel}>{label}</div>
      <div style={{ ...s.statValue, color: color || "#111" }}>
        {plain ? value : `$${value.toFixed(2)}`}
      </div>
    </div>
  );
}

const s = {
  container: {
    maxWidth: 680,
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
  stat: { flex: 1, background: "#f8f9fa", borderRadius: 8, padding: "0.75rem 1rem" },
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
  highlightRow: { background: "#f0fdf4" },
};
