import { list } from "@vercel/blob";

const BLOB_KEY = "price-history.json";

async function loadHistory() {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY });
    if (blobs.length === 0) return null;
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    return await res.json();
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  const history = await loadHistory();
  const prices = history?.prices || [];
  const sorted = [...prices].sort((a, b) => new Date(b.date) - new Date(a.date));

  const lowest = history?.lowest;
  const allPrices = prices.map((p) => p.price);
  const highest = allPrices.length ? Math.max(...allPrices) : null;
  const average = allPrices.length
    ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length
    : null;

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>The Caledonian Edinburgh</h1>
      <p style={styles.subtitle}>Oct 24 – 25, 2026 &middot; Price History</p>

      {prices.length === 0 ? (
        <p style={styles.empty}>
          No price data yet. Trigger a check at <code>/api/check-price</code> first.
        </p>
      ) : (
        <>
          <div style={styles.statsRow}>
            <Stat label="Lowest" value={lowest} color="#16a34a" />
            <Stat label="Average" value={average} color="#2563eb" />
            <Stat label="Highest" value={highest} color="#dc2626" />
            <Stat label="Checks" value={prices.length} plain />
          </div>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ ...styles.th, textAlign: "left" }}>#</th>
                <th style={{ ...styles.th, textAlign: "left" }}>Date</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Price</th>
                <th style={{ ...styles.th, textAlign: "right" }}>vs Lowest</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry, i) => {
                const diff = entry.price - lowest;
                const isLowest = entry.price === lowest;
                return (
                  <tr key={i} style={isLowest ? styles.highlightRow : styles.row}>
                    <td style={{ ...styles.td, color: "#999" }}>
                      {prices.length - i}
                    </td>
                    <td style={styles.td}>
                      {new Date(entry.date).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      ${entry.price.toFixed(2)}
                    </td>
                    <td
                      style={{
                        ...styles.td,
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
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color: color || "#111" }}>
        {plain ? value : `$${value.toFixed(2)}`}
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "2.5rem 1.5rem",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  heading: {
    fontSize: "1.6rem",
    fontWeight: 700,
    margin: 0,
  },
  subtitle: {
    color: "#666",
    margin: "0.25rem 0 2rem",
    fontSize: "0.95rem",
  },
  empty: {
    color: "#888",
    background: "#f5f5f5",
    padding: "1.5rem",
    borderRadius: 8,
    textAlign: "center",
  },
  statsRow: {
    display: "flex",
    gap: "1rem",
    marginBottom: "1.5rem",
  },
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
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.9rem",
  },
  th: {
    padding: "0.6rem 0.75rem",
    borderBottom: "2px solid #e5e7eb",
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#888",
  },
  td: {
    padding: "0.6rem 0.75rem",
    borderBottom: "1px solid #f0f0f0",
  },
  row: {},
  highlightRow: {
    background: "#f0fdf4",
  },
};
