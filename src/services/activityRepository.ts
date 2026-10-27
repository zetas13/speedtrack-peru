import type { Session } from '../types';
import { supabase } from './supabase';

export function validSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Session;
  return typeof s.id === 'string' && typeof s.user_id === 'string' &&
    ['walk', 'run', 'bike', 'vehicle'].includes(s.type) &&
    typeof s.demo === 'boolean' && Number.isFinite(Date.parse(s.start_time)) &&
    [s.distance, s.duration, s.avg_speed, s.max_speed, s.max_acceleration, s.max_deceleration, s.above_limit].every(n => Number.isFinite(n) && n >= 0) &&
    Array.isArray(s.measurements) && s.measurements.every(m => m.session_id === s.id &&
      [m.timestamp, m.elapsed, m.distance, m.speed, m.acceleration].every(Number.isFinite) && m.speed >= 0 && m.distance >= 0 &&
      (m.latitude === null || (Number.isFinite(m.latitude) && Math.abs(m.latitude) <= 90)) &&
      (m.longitude === null || (Number.isFinite(m.longitude) && Math.abs(m.longitude) <= 180))) &&
    Array.isArray(s.splits) && s.splits.every(x => x.session_id === s.id && x.kilometer > 0 && Number.isFinite(x.time) && x.time >= 0 && Number.isFinite(x.pace)) &&
    Array.isArray(s.events) && s.events.every(x => x.session_id === s.id && ['brake','accelerate','over'].includes(x.type) && Number.isFinite(x.value));
}
export function mergeSessions(remote: Session[], local: Session[]) {
  // Completed sessions are immutable. Local outbox entries win until acknowledged.
  return [...new Map([...remote, ...local].map(s => [s.id, s])).values()]
    .sort((a,b) => Date.parse(b.start_time) - Date.parse(a.start_time));
}
const key = (owner: string) => `speedtrack.outbox.${owner}`;
export function pendingSessions(owner: string): Session[] {
  try { const rows: unknown = JSON.parse(localStorage.getItem(key(owner)) || '[]');
    return Array.isArray(rows) ? rows.filter(validSession).filter(s => s.user_id === owner) : [];
  } catch { return []; }
}
export function enqueue(session: Session) {
  localStorage.setItem(key(session.user_id), JSON.stringify(mergeSessions(pendingSessions(session.user_id), [session])));
}
export async function synchronize(owner: string) {
  if (!supabase) return [];
  for (const s of pendingSessions(owner)) {
    const {error} = await supabase.rpc('save_activity', {activity: s});
    if (error) throw error;
    // Read again: a new activity may have been queued while this request ran.
    localStorage.setItem(key(owner), JSON.stringify(pendingSessions(owner).filter(x => x.id !== s.id)));
  }
  const result: Session[] = [];
  for (let offset = 0; ; offset += 100) {
    const {data, error} = await supabase.from('sessions').select('payload').eq('user_id', owner).order('id').range(offset, offset + 99);
    if (error) throw error;
    result.push(...(data ?? []).map(x => x.payload).filter(validSession).filter(s => s.user_id === owner));
    if (!data || data.length < 100) break;
  }
  return result;
}
