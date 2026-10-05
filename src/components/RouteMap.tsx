import type { Measurement } from "../types";
import { useI18n } from "../i18n";
import { MapPin } from "lucide-react";
export function RouteMap({ measurements }: { measurements: Measurement[] }) {
  const { t } = useI18n();
  const points = measurements.filter(
    (m) => m.latitude !== null && m.longitude !== null,
  );
  const lats = points.map((p) => p.latitude!),
    lons = points.map((p) => p.longitude!);
  const minLat = Math.min(...lats),
    minLon = Math.min(...lons),
    spanLat = Math.max(...lats) - minLat || 0.001,
    spanLon = Math.max(...lons) - minLon || 0.001;
  const coords = points.map((p) => [
    30 + ((p.longitude! - minLon) / spanLon) * 280,
    125 - ((p.latitude! - minLat) / spanLat) * 90,
  ]);
  return (
    <div className="route-map">
      <svg viewBox="0 0 340 160" role="img" aria-label={t("route")}>
        <defs>
          <pattern
            id="grid"
            width="35"
            height="35"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M35 0H0V35"
              fill="none"
              stroke="#334035"
              strokeWidth="0.6"
            />
          </pattern>
        </defs>
        <rect width="340" height="160" fill="url(#grid)" />
        <path
          d="M-20 125L110 90L185 175M125 -15L180 60L345 38M-20 55L85 12L195 85L350 110"
          fill="none"
          stroke="#3d493c"
          strokeWidth="10"
        />
        {points.length > 1 && (
          <>
            <polyline
              points={coords.map((c) => c.join(",")).join(" ")}
              fill="none"
              stroke="#c3f65b"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={coords[0][0]}
              cy={coords[0][1]}
              r="5"
              fill="#101412"
              stroke="#c3f65b"
              strokeWidth="3"
            />
            <circle
              cx={coords.at(-1)![0]}
              cy={coords.at(-1)![1]}
              r="6"
              fill="#c3f65b"
            />
          </>
        )}
      </svg>
      <span>
        <MapPin size={12} />
        {t(points.length > 1 ? "conceptual" : "noRoute")}
      </span>
    </div>
  );
}
