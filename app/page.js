export default function Home() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>🏨 Hotel Price Tracker</h1>
      <p>Tracking: <strong>The Caledonian Edinburgh</strong></p>
      <p>Nights: Oct 23, 24 &amp; 25, 2026</p>
      <p style={{ color: "#666", marginTop: "1rem" }}>
        Price checks run automatically. Visit{" "}
        <a href="/prices">/prices</a> to see history and check manually.
      </p>
    </div>
  );
}
