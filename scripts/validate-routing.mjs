import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const env = parseEnv(readFileSync(".env", "utf8"));
assert(env.VITE_ROUTING_API_KEY, "Missing VITE_ROUTING_API_KEY");
const base = env.VITE_ROUTING_URL || "https://api.heigit.org/openrouteservice";
for (const [mode, profile] of Object.entries({
  walk: "foot-walking",
  run: "foot-walking",
  bike: "cycling-regular",
  vehicle: "driving-car",
})) {
  const response = await fetch(`${base}/v2/directions/${profile}/geojson`, {
    method: "POST",
    headers: {
      Authorization: env.VITE_ROUTING_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      coordinates: [
        [-77.0308, -12.1202],
        [-77.0284, -12.1163],
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `${mode}: HTTP ${response.status}`);
  const feature = (await response.json()).features?.[0];
  assert(
    feature?.geometry?.coordinates?.length > 1,
    `${mode}: missing geometry`,
  );
  const summary = feature.properties.summary;
  assert(
    summary.distance > 0 && summary.duration > 0,
    `${mode}: invalid summary`,
  );
  console.log(
    `PASS ${mode} (${profile}): ${summary.distance} m, ${summary.duration} s`,
  );
}
