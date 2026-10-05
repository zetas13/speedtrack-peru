export interface GpsPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number;
  speed: number | null;
}
export function watchGps(
  onPoint: (point: GpsPoint) => void,
  onError: () => void,
): () => void {
  if (!navigator.geolocation || !window.isSecureContext) {
    onError();
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) =>
      onPoint({
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        timestamp: p.timestamp,
        accuracy: p.coords.accuracy,
        speed: p.coords.speed,
      }),
    onError,
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
