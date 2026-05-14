import { list, put } from "@vercel/blob";
import { DEFAULT_TRIP_CONFIG, normalizeTripConfig } from "./trip-config";

const CONFIG_BLOB_KEY = "trip-config.json";

async function loadTripConfig() {
  const { blobs } = await list({ prefix: CONFIG_BLOB_KEY });
  const exact = blobs.find((b) => b.pathname === CONFIG_BLOB_KEY);
  const blob = exact || blobs[0];
  if (!blob) return DEFAULT_TRIP_CONFIG;

  const res = await fetch(blob.url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
  if (!res.ok) return DEFAULT_TRIP_CONFIG;

  const raw = await res.json();
  return normalizeTripConfig(raw);
}

async function saveTripConfig(config) {
  const normalized = normalizeTripConfig(config);
  await put(CONFIG_BLOB_KEY, JSON.stringify(normalized, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return normalized;
}

export { loadTripConfig, saveTripConfig };
