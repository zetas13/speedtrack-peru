import { lazy, Suspense } from "react";
import type { MapProps } from "./WorldMap";
const WorldMap = lazy(() => import("./WorldMap"));
export function RouteMap(props: MapProps) {
  return (
    <Suspense fallback={<div className="map-canvas" aria-busy="true" />}>
      <WorldMap {...props} />
    </Suspense>
  );
}
