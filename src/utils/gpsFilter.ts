import type { ActivityType } from '../types';
import type { GpsPoint } from '../services/gpsService';
import { calculateAcceleration, calculateDistance } from './physics';
const ceilings: Record<ActivityType, number> = {walk: 15, run: 45, bike: 110, vehicle: 250};
export class GpsFilter {
  private previous: GpsPoint | null = null;
  private speed = 0;
  reset() {this.previous = null;this.speed = 0;}
  accept(p: GpsPoint, mode: ActivityType) {
    if (![p.latitude,p.longitude,p.timestamp,p.accuracy].every(Number.isFinite) ||
      Math.abs(p.latitude)>90 || Math.abs(p.longitude)>180 || p.accuracy<0 || p.accuracy>50) return null;
    const prev = this.previous;
    if (prev && p.timestamp <= prev.timestamp) return null;
    const dt = prev ? (p.timestamp-prev.timestamp)/1000 : 0;
    // Reacquire after a signal gap without adding an unobserved straight line.
    if (!prev || dt > 15) {this.previous=p;this.speed=0;return {delta:0,speed:0,acceleration:0};}
    if (dt < 0.5) return null;
    const distance = calculateDistance(prev,p);
    const raw = distance/dt*3600;
    if (raw > ceilings[mode]) return null; // Never promote a rejected jump to the baseline.
    const device = p.speed !== null && Number.isFinite(p.speed) && p.speed >= 0 ? p.speed*3.6 : null;
    if (device !== null && device > ceilings[mode]) return null;
    const stationary = device !== null ? device < 0.7 : distance*1000 < Math.max(2,Math.min(prev.accuracy,p.accuracy)*0.3);
    const rawSpeed = stationary ? 0 : device ?? raw;
    const alpha = 1-Math.exp(-dt/3);
    const speed = stationary ? 0 : this.speed + alpha*(rawSpeed-this.speed);
    const acceleration = calculateAcceleration(this.speed,speed,dt);
    if (Math.abs(acceleration) > (mode === 'vehicle' ? 12 : 6)) return null;
    // Accumulate tiny displacement until it exceeds noise; device speed can establish movement.
    if (!stationary || device !== null) this.previous=p;
    this.speed=speed;
    return {delta:stationary ? 0 : distance,speed,acceleration};
  }
}
