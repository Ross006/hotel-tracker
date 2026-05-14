"use client";

import { useEffect, useState } from "react";

const initial = {
  hotel: {
    enabled: true,
    query: "",
    checkIn: "",
    checkOut: "",
    adults: 2,
    currency: "USD",
  },
  flight: {
    enabled: true,
    origin: "",
    destination: "",
    departDate: "",
    returnDate: "",
    adults: 1,
    cabin: "ECONOMY",
    currency: "USD",
  },
  alerts: {
    targetCombinedPrice: "",
  },
};

export default function ConfigPage() {
  const [config, setConfig] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/trip-config?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      setConfig({
        hotel: data.hotel,
        flight: data.flight,
        alerts: {
          targetCombinedPrice:
            data.alerts?.targetCombinedPrice == null ? "" : String(data.alerts.targetCombinedPrice),
        },
      });
      setLoading(false);
    })();
  }, []);

  function patch(section, key, value) {
    setConfig((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value,
      },
    }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    const payload = {
      ...config,
      alerts: {
        targetCombinedPrice:
          config.alerts.targetCombinedPrice === ""
            ? null
            : Number(config.alerts.targetCombinedPrice),
      },
    };
    const res = await fetch("/api/trip-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(`Error: ${data.error || "failed to save config"}`);
    } else {
      setMessage("Saved. Dashboard checks will now use this configuration.");
    }
    setSaving(false);
  }

  if (loading) return <div style={s.container}>Loading config…</div>;

  return (
    <div style={s.container}>
      <h1 style={s.h1}>Trip Configuration</h1>
      <p style={s.sub}>Controls both hotel and flights on the main dashboard.</p>

      <section style={s.card}>
        <h2 style={s.h2}>Hotel</h2>
        <label style={s.row}>
          <input
            type="checkbox"
            checked={config.hotel.enabled}
            onChange={(e) => patch("hotel", "enabled", e.target.checked)}
          />
          Enable hotel tracking
        </label>
        <label style={s.label}>Hotel query</label>
        <input
          style={s.input}
          value={config.hotel.query}
          onChange={(e) => patch("hotel", "query", e.target.value)}
        />
        <div style={s.grid2}>
          <div>
            <label style={s.label}>Check-in</label>
            <input
              type="date"
              style={s.input}
              value={config.hotel.checkIn}
              onChange={(e) => patch("hotel", "checkIn", e.target.value)}
            />
          </div>
          <div>
            <label style={s.label}>Check-out</label>
            <input
              type="date"
              style={s.input}
              value={config.hotel.checkOut}
              onChange={(e) => patch("hotel", "checkOut", e.target.value)}
            />
          </div>
        </div>
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>Flights</h2>
        <label style={s.row}>
          <input
            type="checkbox"
            checked={config.flight.enabled}
            onChange={(e) => patch("flight", "enabled", e.target.checked)}
          />
          Enable flight tracking
        </label>
        <div style={s.grid2}>
          <div>
            <label style={s.label}>Origin (IATA)</label>
            <input
              style={s.input}
              value={config.flight.origin}
              onChange={(e) => patch("flight", "origin", e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label style={s.label}>Destination (IATA)</label>
            <input
              style={s.input}
              value={config.flight.destination}
              onChange={(e) => patch("flight", "destination", e.target.value.toUpperCase())}
            />
          </div>
        </div>
        <div style={s.grid2}>
          <div>
            <label style={s.label}>Depart date</label>
            <input
              type="date"
              style={s.input}
              value={config.flight.departDate}
              onChange={(e) => patch("flight", "departDate", e.target.value)}
            />
          </div>
          <div>
            <label style={s.label}>Return date</label>
            <input
              type="date"
              style={s.input}
              value={config.flight.returnDate}
              onChange={(e) => patch("flight", "returnDate", e.target.value)}
            />
          </div>
        </div>
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>Alerts</h2>
        <label style={s.label}>Target combined price (optional)</label>
        <input
          type="number"
          style={s.input}
          value={config.alerts.targetCombinedPrice}
          onChange={(e) => patch("alerts", "targetCombinedPrice", e.target.value)}
          placeholder="e.g. 2100"
        />
      </section>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={save} disabled={saving} style={s.btn}>
          {saving ? "Saving…" : "Save Config"}
        </button>
        <a href="/" style={s.link}>Back to dashboard</a>
      </div>
      {message && <p style={s.msg}>{message}</p>}
    </div>
  );
}

const s = {
  container: {
    maxWidth: 760,
    margin: "0 auto",
    padding: "2rem 1.25rem",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  h1: { margin: 0, fontSize: "1.7rem" },
  h2: { margin: "0 0 0.7rem", fontSize: "1.1rem" },
  sub: { color: "#666", marginTop: 6 },
  card: {
    background: "#f8f9fa",
    borderRadius: 10,
    padding: "1rem",
    margin: "1rem 0",
  },
  row: { display: "flex", gap: 8, alignItems: "center", marginBottom: 10 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  label: { display: "block", fontSize: "0.82rem", color: "#555", marginBottom: 4 },
  input: {
    width: "100%",
    padding: "0.6rem 0.65rem",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: "0.92rem",
    boxSizing: "border-box",
    marginBottom: 8,
  },
  btn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "0.55rem 1rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  link: { color: "#2563eb", textDecoration: "none", fontSize: "0.9rem" },
  msg: { marginTop: 10, color: "#374151", fontSize: "0.9rem" },
};
