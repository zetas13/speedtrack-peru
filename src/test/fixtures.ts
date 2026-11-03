import type { ActivityType } from "../types";
import { addMeasurement } from "../utils/physics";
import { newSession } from "../utils/session";
import { demoMeasurement } from "../utils/simulation";
export {
  demoMeasurement,
  demoSpeed,
  demoScale,
  DEMO_SECONDS,
} from "../utils/simulation";
export function fixtureSession(type: ActivityType) {
  let s = newSession(type, 50, null);
  for (let i = 0; i <= 45; i++) s = addMeasurement(s, demoMeasurement(s, i));
  return { ...s, end_time: new Date().toISOString() };
}
