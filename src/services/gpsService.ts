import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
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
  if (Capacitor.isNativePlatform()) {
    let stopped = false;
    let watchId: string | undefined;
    void (async () => {
      try {
        const permission = await Geolocation.requestPermissions();
        if (stopped) return;
        if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') {onError();return;}
        watchId = await Geolocation.watchPosition({enableHighAccuracy:true, timeout:12000, minimumUpdateInterval:1000}, (p, error) => {
          if (stopped) return;
          if (error || !p) {onError();return;}
          onPoint({latitude:p.coords.latitude,longitude:p.coords.longitude,timestamp:p.timestamp,accuracy:p.coords.accuracy,speed:p.coords.speed});
        });
        if (stopped && watchId) await Geolocation.clearWatch({id:watchId});
      } catch {if (!stopped) onError();}
    })();
    return () => {stopped = true;if(watchId) void Geolocation.clearWatch({id:watchId}).catch(()=>{});};
  }
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
