export default function Home() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>🏨 Hotel Price Tracker</h1>
      <p>Tracking: <strong>The Caledonian Edinburgh</strong></p>
      <p>Dates: Oct 24–25, 2026</p>
      <p style={{ color: "#666", marginTop: "1rem" }}>
        Price checks run automatically. Visit{" "}
        <code>/api/check-price</code> to trigger manually.
      </p>
    </div>
  );
}
